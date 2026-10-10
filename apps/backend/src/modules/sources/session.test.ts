import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ScrapeRunRow, SourceRow } from '../../db/schema/index.js';
import { runScrape } from '../../scraping/run.js';
import type { SourceAdapter } from '../../sources/types.js';
import { listingItem, minimalCandidate, testAdapter } from '../../testing/scraping.js';
import { createSessionHooks } from '../../scraping/sessions.js';
import {
  devfolioHtml,
  devfolioRoutes,
  fakeTransport,
  openDevfolioHarness,
  robotsUrl,
  type DevfolioHarness,
} from '../../testing/devfolio.js';
import {
  definitionOf,
  secretSettingKeys,
  type SettingDefinition,
} from '../../platform/settings.js';
import '../../settings.js';
import {
  clearSession,
  expiredDetail,
  openSession,
  resolveSessionCredential,
  sealStoredSessions,
  sessionConfigOf,
  sessionStatus,
  storeSession,
  unavailableDetail,
  type SessionVault,
} from './session.js';
import { isSealed, parseSessionKey } from './seal.js';
import { TEST_SESSION_KEY_HEX } from '../../testing/session-key.js';

/**
 * The professor's own signed-in session (owner ruling R74 / D-34, WP-14).
 *
 * Every rule here is asserted against the transport, the log stream or the
 * stored rows rather than against the code that is supposed to follow it: R74
 * is a promise about where a person's cookie goes, and "we wrote it carefully"
 * is not evidence.
 */

const COOKIE = 'df_session=abc123; other=zzz';
const LISTING = 'https://devfolio.co/hackathons';

let harness: DevfolioHarness;

/** Signs the app in to Devfolio as the test's professor. */
function signIn(at = harness.clock.now().getTime()): void {
  storeSession(harness.source, harness.vault, COOKIE, 'admin-1', at);
}

const DETAIL = 'https://recursiveacm.devfolio.co/';

/**
 * A Devfolio-keyed adapter whose detail step asks for the session (R75's
 * targeted read). The listing is fetched plainly, as every listing walk is.
 * `revision` moves the candidate, so a second run updates a stored event.
 */
function targetedAdapter(revision: number): SourceAdapter {
  return testAdapter({
    key: 'devfolio',
    fetches: [LISTING],
    items: [listingItem('recursiveacm', revision)],
    normalize: (item) =>
      minimalCandidate({
        sourceKey: 'devfolio',
        externalKey: item.externalKey,
        url: DETAIL,
        title: `Recursive ${revision}`,
        titleRaw: `Recursive ${revision}`,
      }),
    detail: async (context, item) => {
      await context.http.get(DETAIL, { access: 'signed-in' });
      return { item, payload: item.payload };
    },
  });
}

/** Two runs: the first stores the event, the second reads its page signed in. */
async function runTargeted(
  transport: ReturnType<typeof fakeTransport>,
  vault: SessionVault = harness.vault,
): Promise<ScrapeRunRow> {
  const deps = {
    credentials: (source: SourceRow) => resolveSessionCredential(source, vault),
    sessions: createSessionHooks(vault),
  };
  await runScrape(harness.deps(transportForOneHackathon(), undefined, deps), {
    source: harness.source,
    adapter: targetedAdapter(1),
    trigger: 'SCHEDULE',
  });
  harness.clock.advance(3_600_000);
  return runScrape(harness.deps(transport, undefined, deps), {
    source: harness.source,
    adapter: targetedAdapter(2),
    trigger: 'SCHEDULE',
  });
}

function transportForOneHackathon(): ReturnType<typeof fakeTransport> {
  return fakeTransport(
    devfolioRoutes(devfolioHtml('listing.html'), {
      recursiveacm: devfolioHtml('detail-recursiveacm.html'),
    }),
  );
}

beforeEach(() => {
  harness = openDevfolioHarness();
});

afterEach(() => {
  harness.close();
});

describe('where the cookie goes', () => {
  it('is declared by the source, not by the code that sends it', () => {
    const config = sessionConfigOf(harness.source);
    expect(config?.header).toBe('Cookie');
    expect(config?.hosts).toEqual(['devfolio.co', '*.devfolio.co']);
    expect(config?.loginUrl).toBe('https://devfolio.co/discover?auth=signin');
  });

  it('is never sent on a listing walk, nor for a new event’s page (R75)', async () => {
    signIn();
    const transport = transportForOneHackathon();
    await runScrape(
      harness.deps(transport, undefined, {
        credentials: (source) => resolveSessionCredential(source, harness.vault),
        sessions: createSessionHooks(harness.vault),
      }),
      { source: harness.source, adapter: harness.adapter, trigger: 'MANUAL' },
    );
    expect(transport.calls.map((call) => call.url)).toContain(LISTING);
    expect(transport.calls.every((call) => call.headers.cookie === undefined)).toBe(true);
  });

  it('is sent on a stored event’s page when asked, and nowhere else — not even robots.txt', async () => {
    signIn();
    const transport = transportForOneHackathon();
    await runTargeted(transport);
    const withCookie = transport.calls.filter((call) => call.headers.cookie !== undefined);
    expect(withCookie.map((call) => call.url)).toEqual([DETAIL]);
    expect(withCookie.every((call) => call.headers.cookie === COOKIE)).toBe(true);
    // Every robots.txt is fetched without it: robots is a request about the
    // site's rules, not about the professor's account.
    const robots = transport.calls.filter((call) => call.url.endsWith('/robots.txt'));
    expect(robots.every((call) => call.headers.cookie === undefined)).toBe(true);
  });

  it('is never sent to another host, even one the run happens to touch', async () => {
    signIn();
    const transport = fakeTransport({
      ...devfolioRoutes(devfolioHtml('listing.html'), {
        recursiveacm: devfolioHtml('detail-recursiveacm.html'),
      }),
      [robotsUrl('api.devfolio.co')]: { body: 'User-agent: *\nDisallow:\n' },
      'https://api.devfolio.co/hackathons': { body: '{}' },
    });
    await runScrape(
      harness.deps(transport, undefined, {
        credentials: (source) => resolveSessionCredential(source, harness.vault),
        sessions: createSessionHooks(harness.vault),
      }),
      { source: harness.source, adapter: harness.adapter, trigger: 'MANUAL' },
    );
    // The denied host is never contacted at all (WP-12), and so cannot have
    // received the cookie; this asserts both at once.
    expect(transport.calls.map((call) => call.url)).not.toContain(
      'https://api.devfolio.co/hackathons',
    );
    expect(transport.calls.filter((call) => call.url.includes('api.devfolio.co'))).toHaveLength(0);
  });
});

describe('where the cookie never appears', () => {
  it('is a secret setting, so an export reports only that it is set', () => {
    signIn();
    expect(secretSettingKeys()).toContain('sources.devfolio.sessionCookie');
    const exported = JSON.stringify(harness.settings.exportableSettings());
    expect(exported).not.toContain('abc123');
    expect(exported).toContain('sources.devfolio.sessionCookie');
  });

  it('is never in what the API answers with', () => {
    signIn();
    const status = sessionStatus(harness.source, harness.vault);
    expect(JSON.stringify(status)).not.toContain('abc123');
    expect(status).toMatchObject({ supported: true, isSet: true, state: 'ACTIVE' });
    expect(status.capturedAt).toBe(harness.clock.now().getTime());
  });

  it('is gone once the professor signs the app out', () => {
    signIn();
    clearSession(harness.source, harness.settings, 'admin-1');
    const status = sessionStatus(harness.source, harness.vault);
    expect(status.isSet).toBe(false);
    expect(status.state).toBe('NONE');
    expect(resolveSessionCredential(harness.source, harness.vault)).toBeUndefined();
  });

  it('has no session at all for a source whose verdict does not allow one', () => {
    const ctftime = harness.sources.findByKey('ctftime');
    expect(sessionConfigOf(ctftime!)).toBeUndefined();
    expect(sessionStatus(ctftime!, harness.vault)).toMatchObject({
      supported: false,
      isSet: false,
      hosts: [],
    });
  });
});

describe('a session is sealed at rest (R76)', () => {
  /** The stored value, straight out of the settings table. */
  function stored(): string {
    return harness.settings.get(
      definitionOf('sources.devfolio.sessionCookie') as SettingDefinition<string>,
    );
  }

  it('is unreadable without the key, and readable with it', () => {
    signIn();
    const raw = stored();
    expect(isSealed(raw)).toBe(true);
    expect(raw).not.toContain('abc123');
    expect(raw).not.toContain('df_session');
    expect(openSession(harness.source, harness.vault)).toBe(COOKIE);

    // A different key — a backup restored on another machine — opens nothing.
    const elsewhere: SessionVault = {
      settings: harness.settings,
      key: parseSessionKey('a1'.repeat(32)),
    };
    expect(openSession(harness.source, elsewhere)).toBeUndefined();
    expect(resolveSessionCredential(harness.source, elsewhere)).toBeUndefined();
  });

  it('says so, and reads the public pages, when this machine holds no key', async () => {
    signIn();
    const keyless: SessionVault = { settings: harness.settings, key: undefined };

    const status = sessionStatus(harness.source, keyless);
    expect(status).toMatchObject({ supported: true, isSet: true, state: 'UNAVAILABLE' });
    expect(JSON.stringify(status)).not.toContain('abc123');
    expect(unavailableDetail(harness.source)).toContain('cannot be opened on this machine');

    const transport = transportForOneHackathon();
    await runScrape(
      harness.deps(transport, undefined, {
        credentials: (source) => resolveSessionCredential(source, keyless),
        sessions: createSessionHooks(keyless),
      }),
      { source: harness.source, adapter: harness.adapter, trigger: 'SCHEDULE' },
    );
    // The run happened, anonymously, which is exactly the "no session" state.
    expect(transport.calls.map((call) => call.url)).toContain(LISTING);
    expect(transport.calls.every((call) => call.headers.cookie === undefined)).toBe(true);
  });

  it('nothing is stored at all on a backend with no key', () => {
    const keyless: SessionVault = { settings: harness.settings, key: undefined };
    expect(storeSession(harness.source, keyless, COOKIE, 'admin-1', 1)).toBe(false);
    expect(stored()).toBe('');
  });

  it('seals a plaintext session an older build left behind, once', () => {
    // What WP-14 wrote: the cookie itself, in the setting.
    harness.settings.set(
      definitionOf('sources.devfolio.sessionCookie') as SettingDefinition<string>,
      COOKIE,
      'admin-1',
    );
    expect(isSealed(stored())).toBe(false);

    const sources = harness.sources.list();
    expect(sealStoredSessions(sources, harness.vault)).toBe(1);
    const sealed = stored();
    expect(isSealed(sealed)).toBe(true);
    expect(openSession(harness.source, harness.vault)).toBe(COOKIE);

    // Idempotent: a second pass has nothing to do and changes nothing.
    expect(sealStoredSessions(sources, harness.vault)).toBe(0);
    expect(stored()).toBe(sealed);
  });

  it('leaves a plaintext session alone rather than destroying it without a key', () => {
    harness.settings.set(
      definitionOf('sources.devfolio.sessionCookie') as SettingDefinition<string>,
      COOKIE,
      'admin-1',
    );
    const keyless: SessionVault = { settings: harness.settings, key: undefined };
    expect(sealStoredSessions(harness.sources.list(), keyless)).toBe(0);
    expect(stored()).toBe(COOKIE);
    // It is still not used: only a sealed value is ever sent (R76).
    expect(resolveSessionCredential(harness.source, keyless)).toBeUndefined();
  });

  it('the key the harness uses is the shape the shell sends', () => {
    expect(TEST_SESSION_KEY_HEX).toMatch(/^[0-9a-f]{64}$/);
    expect(parseSessionKey(TEST_SESSION_KEY_HEX)).toHaveLength(32);
  });
});

describe('an expired session is a source state, not a failure (R74, R80)', () => {
  /** A site that answers the signed-in read of a stored event with 401. */
  function refusing(): ReturnType<typeof fakeTransport> {
    return fakeTransport({
      ...devfolioRoutes(devfolioHtml('listing.html'), {}),
      [robotsUrl('recursiveacm.devfolio.co')]: { body: 'User-agent: *\nDisallow:\n' },
      [DETAIL]: { status: 401, body: 'no' },
    });
  }

  it('marks the session expired, records §7.7’s sentence, and does not back the site off', async () => {
    signIn();
    const before = harness.sources.state(harness.source.id, harness.clock.now().getTime());
    await runTargeted(refusing());

    const status = sessionStatus(harness.source, harness.vault);
    expect(status.state).toBe('EXPIRED');
    expect(status.isSet).toBe(true);

    const after = harness.sources.state(harness.source.id, harness.clock.now().getTime());
    expect(after.consecutiveFailures).toBe(before.consecutiveFailures);
    expect(after.backoffUntil).toBeNull();
    // R80: the page was read anonymously, so the run itself succeeded; the
    // sentence is the source's standing notice until the professor signs in.
    expect(after.notice).toBe(expiredDetail(harness.source));
    expect(after.notice).toContain('sign in again');
  });

  it('stops sending it, so the next run reads the public pages', async () => {
    signIn();
    await runTargeted(refusing());
    expect(resolveSessionCredential(harness.source, harness.vault)).toBeUndefined();

    const transport = transportForOneHackathon();
    harness.clock.advance(3_600_000);
    await runScrape(
      harness.deps(transport, undefined, {
        credentials: (source) => resolveSessionCredential(source, harness.vault),
        sessions: createSessionHooks(harness.vault),
      }),
      { source: harness.source, adapter: targetedAdapter(3), trigger: 'SCHEDULE' },
    );
    expect(transport.calls.every((call) => call.headers.cookie === undefined)).toBe(true);
    expect(transport.calls.map((call) => call.url)).toContain(DETAIL);
  });

  it('a run that used it and was not refused records when the session last worked', async () => {
    signIn();
    await runTargeted(transportForOneHackathon());
    expect(sessionStatus(harness.source, harness.vault).lastVerifiedAt).not.toBeNull();
  });

  it('a run that never used it does not claim it worked', async () => {
    signIn();
    await runScrape(
      harness.deps(transportForOneHackathon(), undefined, {
        credentials: (source) => resolveSessionCredential(source, harness.vault),
        sessions: createSessionHooks(harness.vault),
      }),
      { source: harness.source, adapter: harness.adapter, trigger: 'SCHEDULE' },
    );
    expect(sessionStatus(harness.source, harness.vault).lastVerifiedAt).toBeNull();
  });
});

describe('D-29 is unchanged by signing in', () => {
  it('a signed-in read still drops every person on the page', async () => {
    signIn();
    const transport = fakeTransport(
      devfolioRoutes(devfolioHtml('listing.html'), {
        recursiveacm: devfolioHtml('detail-pii.html'),
      }),
    );
    await runScrape(
      harness.deps(transport, undefined, {
        credentials: (source) => resolveSessionCredential(source, harness.vault),
        sessions: createSessionHooks(harness.vault),
      }),
      { source: harness.source, adapter: harness.adapter, trigger: 'MANUAL' },
    );
    const payloads = harness.records
      .list(harness.source.id)
      .map((record) => record.payloadJson)
      .join('\n');
    expect(payloads).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(payloads).not.toMatch(/"participants"|"judges"|"mentors"|"contact_email"/);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runScrape } from '../../scraping/run.js';
import { createSessionHooks } from '../../scraping/sessions.js';
import {
  devfolioHtml,
  devfolioRoutes,
  fakeTransport,
  openDevfolioHarness,
  robotsUrl,
  type DevfolioHarness,
} from '../../testing/devfolio.js';
import { secretSettingKeys } from '../../platform/settings.js';
import '../../settings.js';
import {
  clearSession,
  expiredDetail,
  resolveSessionCredential,
  sessionConfigOf,
  sessionStatus,
  storeSession,
} from './session.js';

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
  storeSession(harness.source, harness.settings, COOKIE, 'admin-1', at);
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
    expect(config?.loginUrl).toBe('https://devfolio.co/login');
  });

  it('is sent to the source’s own pages and to nothing else — not even robots.txt', async () => {
    signIn();
    const transport = transportForOneHackathon();
    await runScrape(
      harness.deps(transport, undefined, {
        credentials: (source) => resolveSessionCredential(source, harness.settings),
        sessions: createSessionHooks(harness.settings),
      }),
      { source: harness.source, adapter: harness.adapter, trigger: 'MANUAL' },
    );

    const withCookie = transport.calls.filter((call) => call.headers.cookie !== undefined);
    const without = transport.calls.filter((call) => call.headers.cookie === undefined);
    expect(withCookie.map((call) => call.url)).toEqual([
      LISTING,
      'https://recursiveacm.devfolio.co/',
    ]);
    // Every robots.txt is fetched without it: robots is a request about the
    // site's rules, not about the professor's account.
    expect(without.map((call) => call.url).every((url) => url.endsWith('/robots.txt'))).toBe(true);
    expect(withCookie.every((call) => call.headers.cookie === COOKIE)).toBe(true);
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
        credentials: (source) => resolveSessionCredential(source, harness.settings),
        sessions: createSessionHooks(harness.settings),
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
    const status = sessionStatus(harness.source, harness.settings);
    expect(JSON.stringify(status)).not.toContain('abc123');
    expect(status).toMatchObject({ supported: true, isSet: true, state: 'ACTIVE' });
    expect(status.capturedAt).toBe(harness.clock.now().getTime());
  });

  it('is gone once the professor signs the app out', () => {
    signIn();
    clearSession(harness.source, harness.settings, 'admin-1');
    const status = sessionStatus(harness.source, harness.settings);
    expect(status.isSet).toBe(false);
    expect(status.state).toBe('NONE');
    expect(resolveSessionCredential(harness.source, harness.settings)).toBeUndefined();
  });

  it('has no session at all for a source whose verdict does not allow one', () => {
    const ctftime = harness.sources.findByKey('ctftime');
    expect(sessionConfigOf(ctftime!)).toBeUndefined();
    expect(sessionStatus(ctftime!, harness.settings)).toMatchObject({
      supported: false,
      isSet: false,
      hosts: [],
    });
  });
});

describe('an expired session is a source state, not a failure (R74)', () => {
  /** A site that answers a signed-in read with 401. */
  function refusing(): ReturnType<typeof fakeTransport> {
    return fakeTransport({
      [robotsUrl('devfolio.co')]: { body: 'User-agent: *\nDisallow:\n' },
      [LISTING]: { status: 401, body: 'no' },
    });
  }

  it('marks the session expired, records §7.7’s sentence, and does not back the site off', async () => {
    signIn();
    const before = harness.sources.state(harness.source.id, harness.clock.now().getTime());
    const transport = refusing();
    const row = await runScrape(
      harness.deps(transport, undefined, {
        credentials: (source) => resolveSessionCredential(source, harness.settings),
        sessions: createSessionHooks(harness.settings),
      }),
      { source: harness.source, adapter: harness.adapter, trigger: 'SCHEDULE' },
    );

    expect(row.errorKind).toBe('BLOCKED');
    const status = sessionStatus(harness.source, harness.settings);
    expect(status.state).toBe('EXPIRED');
    expect(status.isSet).toBe(true);

    const after = harness.sources.state(harness.source.id, harness.clock.now().getTime());
    expect(after.consecutiveFailures).toBe(before.consecutiveFailures);
    expect(after.backoffUntil).toBeNull();
    expect(after.lastErrorMessage).toBe(expiredDetail(harness.source));
    expect(after.lastErrorMessage).toContain('sign in again');
  });

  it('stops sending it, so the next run reads the public pages', async () => {
    signIn();
    await runScrape(
      harness.deps(refusing(), undefined, {
        credentials: (source) => resolveSessionCredential(source, harness.settings),
        sessions: createSessionHooks(harness.settings),
      }),
      { source: harness.source, adapter: harness.adapter, trigger: 'SCHEDULE' },
    );
    expect(resolveSessionCredential(harness.source, harness.settings)).toBeUndefined();

    const transport = transportForOneHackathon();
    harness.clock.advance(3_600_000);
    await runScrape(
      harness.deps(transport, undefined, {
        credentials: (source) => resolveSessionCredential(source, harness.settings),
        sessions: createSessionHooks(harness.settings),
      }),
      { source: harness.source, adapter: harness.adapter, trigger: 'SCHEDULE' },
    );
    expect(transport.calls.every((call) => call.headers.cookie === undefined)).toBe(true);
    expect(transport.calls.map((call) => call.url)).toContain(LISTING);
  });

  it('a run that was not refused records when the session last worked', async () => {
    signIn();
    const transport = transportForOneHackathon();
    await runScrape(
      harness.deps(transport, undefined, {
        credentials: (source) => resolveSessionCredential(source, harness.settings),
        sessions: createSessionHooks(harness.settings),
      }),
      { source: harness.source, adapter: harness.adapter, trigger: 'SCHEDULE' },
    );
    expect(sessionStatus(harness.source, harness.settings).lastVerifiedAt).not.toBeNull();
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
        credentials: (source) => resolveSessionCredential(source, harness.settings),
        sessions: createSessionHooks(harness.settings),
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

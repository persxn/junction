import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toStatus } from '../modules/sources/mappers.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import type { SourceRow } from '../db/schema/index.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';
import {
  fakeTransport,
  insertSource,
  listingItem,
  minimalCandidate,
  movableClock,
  silentLogger,
  testAdapter,
  testScrapingHttp,
  type FakeResponse,
  type FakeTransport,
} from '../testing/scraping.js';
import type { SourceAdapter } from '../sources/types.js';
import type { Sleeper, SourceCredential } from './http/index.js';
import { runScrape, type ScrapeRunDependencies } from './run.js';
import type { SessionHooks } from './sessions.js';
import { repeatedBlockDetail, refusedKeyDetail } from './standing.js';

/**
 * Rulings R79 and R80 at run level: what a refusal does to a source's standing.
 *
 * R80 — a refused credential is a state, never `BLOCKED`, never a backoff.
 * R79 — one block backs a source off; the third in a row switches it off.
 */

const ROBOTS = 'https://example.test/robots.txt';
const LISTING = 'https://example.test/api/listing';
const DETAIL = 'https://example.test/api/detail';
const ALLOW_ALL = 'User-agent: *\nDisallow:\n';
const LOGIN_PAGE =
  '<html><head><title>Sign in · Example</title></head><body><form><input type="password" name="p"></form></body></html>';

let database: MigratedDatabase;
let clock: ReturnType<typeof movableClock>;
let sources: SourcesRepository;

beforeEach(() => {
  database = openMigratedDatabase(silentLogger, 'standing');
  clock = movableClock('2026-09-21T10:00:00.000Z');
  sources = new SourcesRepository(database.db);
});

afterEach(() => {
  database.close();
});

const advancing: Sleeper = (ms) => {
  clock.advance(ms);
  return Promise.resolve();
};

function deps(
  transport: FakeTransport,
  extra: Partial<ScrapeRunDependencies> = {},
): ScrapeRunDependencies {
  return {
    sources,
    records: new SourceRecordsRepository(database.db),
    http: testScrapingHttp({ transport, clock, sleep: advancing }),
    clock,
    logger: silentLogger,
    setupComplete: () => true,
    ...extra,
  };
}

function routes(listing: FakeResponse | readonly FakeResponse[]): FakeTransport {
  return fakeTransport({ [ROBOTS]: { body: ALLOW_ALL }, [LISTING]: listing });
}

function fresh(source: SourceRow): SourceRow {
  return sources.findById(source.id)!;
}

function messageOf(source: SourceRow): string {
  const now = clock.now().getTime();
  return toStatus({
    source: fresh(source),
    state: sources.state(source.id, now),
    latestRun: sources.latestRun(source.id),
    now,
  }).message;
}

describe('R80 — a refused API key is a state of the source', () => {
  const KEY: SourceCredential = { kind: 'API_KEY', header: 'Authorization', value: 'ApiKey u:k' };
  const keyed = { credentials: () => KEY };

  it('a 401 marks it EXPIRED, with no backoff, no streak and no R79 count', async () => {
    const source = insertSource(database.db);
    const transport = routes({ status: 401, body: 'nope' });
    const row = await runScrape(deps(transport, keyed), {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });

    expect(row.errorKind).toBe('HTTP_4XX');
    expect(row.outcome).toBe('BLOCKED_BY_POLICY');
    const state = sources.state(source.id, clock.now().getTime());
    expect(state.credentialState).toBe('EXPIRED');
    expect(state.consecutiveFailures).toBe(0);
    expect(state.backoffUntil).toBeNull();
    expect(state.consecutiveBlocked).toBe(0);
    expect(messageOf(source)).toBe(refusedKeyDetail(source));
    // Asked once; a 401 is never retried.
    expect(transport.countFor(LISTING)).toBe(1);
  });

  it('stops sending it: the next run makes no request until a key is stored', async () => {
    const source = insertSource(database.db);
    await runScrape(deps(routes({ status: 401 }), keyed), {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    clock.advance(3_600_000);
    const next = routes({ body: '{}' });
    const row = await runScrape(deps(next, keyed), {
      source: fresh(source),
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(row.outcome).toBe('BLOCKED_BY_POLICY');
    expect(next.calls).toHaveLength(0);

    // A new key answers the refusal (what `setCredential` does).
    sources.setCredentialState(source.id, null);
    sources.setNotice(source.id, null);
    clock.advance(3_600_000);
    const after = routes({ body: '{}' });
    await runScrape(deps(after, keyed), {
      source: fresh(source),
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(after.calls.find((call) => call.url === LISTING)?.headers.authorization).toBe(
      'ApiKey u:k',
    );
  });

  it('an anonymous 401 is the site refusing us, so it stays BLOCKED', async () => {
    const source = insertSource(database.db);
    const row = await runScrape(deps(routes({ status: 401 })), {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(row.errorKind).toBe('BLOCKED');
    expect(sources.state(source.id, clock.now().getTime()).consecutiveBlocked).toBe(1);
  });
});

describe('R80 — a login-page 403 on a signed-in read', () => {
  const SESSION: SourceCredential = {
    kind: 'SESSION',
    header: 'Cookie',
    value: 'sid=professor',
    hosts: ['example.test'],
  };
  const expired: string[] = [];
  const hooks: SessionHooks = {
    isActive: () => true,
    expire: (source) => {
      expired.push(source.key);
      return true;
    },
    verify: () => undefined,
    expiredDetail: (source) => `Your ${source.name} session expired — sign in again.`,
  };

  function targeted(revision: number): SourceAdapter {
    return testAdapter({
      fetches: [LISTING],
      items: [listingItem('e1', revision)],
      normalize: (item) =>
        minimalCandidate({ externalKey: item.externalKey, title: `T ${revision}` }),
      detail: async (context, item) => {
        await context.http.get(DETAIL, { access: 'signed-in' });
        return { item, payload: item.payload };
      },
    });
  }

  it('expires the session, reads the page anonymously, and does not back off', async () => {
    expired.length = 0;
    const source = insertSource(database.db, { maxRequestsPerRun: 20 });
    const extra = { credentials: () => SESSION, sessions: hooks };
    await runScrape(deps(routes({ body: '{}' }), extra), {
      source,
      adapter: targeted(1),
      trigger: 'SCHEDULE',
    });

    clock.advance(3_600_000);
    const transport = fakeTransport({
      [ROBOTS]: { body: ALLOW_ALL },
      [LISTING]: { body: '{}' },
      // The signed-in read gets the sign-in form; the anonymous one the page.
      [DETAIL]: [{ status: 403, body: LOGIN_PAGE }, { body: '{}' }],
    });
    const row = await runScrape(deps(transport, extra), {
      source: fresh(source),
      adapter: targeted(2),
      trigger: 'SCHEDULE',
    });

    expect(row.outcome).toBe('SUCCESS');
    const details = transport.calls.filter((call) => call.url === DETAIL);
    expect(details.map((call) => call.headers.cookie)).toEqual(['sid=professor', undefined]);
    expect(expired).toEqual(['testsource']);
    const state = sources.state(source.id, clock.now().getTime());
    expect(state.backoffUntil).toBeNull();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.consecutiveBlocked).toBe(0);
    expect(messageOf(source)).toContain('session expired');
  });

  it('a 403 that is not a sign-in page is a block, not a credential', async () => {
    const source = insertSource(database.db, { maxRequestsPerRun: 20 });
    const extra = { credentials: () => SESSION, sessions: hooks };
    await runScrape(deps(routes({ body: '{}' }), extra), {
      source,
      adapter: targeted(1),
      trigger: 'SCHEDULE',
    });
    clock.advance(3_600_000);
    expired.length = 0;
    const transport = fakeTransport({
      [ROBOTS]: { body: ALLOW_ALL },
      [LISTING]: { body: '{}' },
      [DETAIL]: { status: 403, body: '<html><title>Access denied</title></html>' },
    });
    const row = await runScrape(deps(transport, extra), {
      source: fresh(source),
      adapter: targeted(2),
      trigger: 'SCHEDULE',
    });
    expect(row.errorKind).toBe('BLOCKED');
    expect(expired).toEqual([]);
  });
});

describe('R79 — three blocks in a row go to a person', () => {
  async function blockedRun(source: SourceRow): Promise<void> {
    // Past any backoff, so each attempt reaches the site.
    clock.advance(24 * 3_600_000);
    await runScrape(deps(routes({ status: 403, body: 'denied' })), {
      source: fresh(source),
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
  }

  it('two BLOCKED runs change nothing; the third disables the source', async () => {
    const source = insertSource(database.db);
    await blockedRun(source);
    await blockedRun(source);
    expect(fresh(source)).toMatchObject({
      complianceStatus: 'APPROVED_WITH_LIMITS',
      isEnabled: true,
    });
    expect(sources.state(source.id, clock.now().getTime()).consecutiveBlocked).toBe(2);

    await blockedRun(source);
    expect(fresh(source)).toMatchObject({ complianceStatus: 'BLOCKED', isEnabled: false });
    expect(messageOf(source)).toBe(repeatedBlockDetail(source));

    // R60: a BLOCKED verdict makes zero requests.
    clock.advance(24 * 3_600_000);
    const after = routes({ body: '{}' });
    const row = await runScrape(deps(after), {
      source: fresh(source),
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(row.outcome).toBe('BLOCKED_BY_POLICY');
    expect(after.calls).toHaveLength(0);
  });

  it('a run the site answered resets the count', async () => {
    const source = insertSource(database.db);
    await blockedRun(source);
    await blockedRun(source);
    clock.advance(24 * 3_600_000);
    await runScrape(deps(routes({ body: '{}' })), {
      source: fresh(source),
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(sources.state(source.id, clock.now().getTime()).consecutiveBlocked).toBe(0);
    await blockedRun(source);
    expect(fresh(source).isEnabled).toBe(true);
  });

  it('an administrator’s re-enable restores the verdict a person had reached', async () => {
    const source = insertSource(database.db);
    for (let run = 0; run < 3; run += 1) {
      await blockedRun(source);
    }
    const blocked = fresh(source);
    const at = clock.now().getTime();
    sources.update(blocked.id, { isEnabled: true }, blocked.version, at);
    const restored = sources.restoreAfterBlock(blocked.id, at);
    expect(restored).toMatchObject({ complianceStatus: 'APPROVED_WITH_LIMITS', isEnabled: true });
    const state = sources.state(source.id, at);
    expect(state).toMatchObject({ consecutiveBlocked: 0, verdictBeforeBlock: null, notice: null });
    // A verdict a person wrote is not undone by a switch.
    expect(sources.restoreAfterBlock(blocked.id, at)).toBeUndefined();
  });
});

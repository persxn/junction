import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
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
  type FakeTransport,
} from '../testing/scraping.js';
import type { SourceAdapter } from '../sources/types.js';
import { refreshDetails } from './detail-refresh.js';
import type { Sleeper, SourceCredential, SourceRequestContext } from './http/index.js';
import { runScrape, type ScrapeRunDependencies } from './run.js';
import type { SessionHooks } from './sessions.js';

/**
 * Ruling R75: signed-in reads are targeted, not bulk.
 *
 * Every assertion is on the transport — which requests carried the cookie, and
 * when — because R75 is a promise about what reaches somebody else's server.
 */

const ROBOTS = 'https://example.test/robots.txt';
const LISTING = 'https://example.test/api/listing';
const DETAIL = 'https://example.test/api/detail';
const ALLOW_ALL = 'User-agent: *\nDisallow:\n';
const COOKIE = 'sid=professor';

const SESSION: SourceCredential = {
  kind: 'SESSION',
  header: 'Cookie',
  value: COOKIE,
  hosts: ['example.test'],
  budget: { maxRequests: 5, minIntervalMs: 10_000 },
};

let database: MigratedDatabase;
let clock: ReturnType<typeof movableClock>;

beforeEach(() => {
  database = openMigratedDatabase(silentLogger, 'signed-in');
  clock = movableClock('2026-09-21T10:00:00.000Z');
});

afterEach(() => {
  database.close();
});

/** A sleeper that moves the clock, so spacing is measured in clock time. */
function advancingSleeper(): Sleeper {
  return (ms) => {
    clock.advance(ms);
    return Promise.resolve();
  };
}

function transport(): FakeTransport {
  return fakeTransport({
    [ROBOTS]: { body: ALLOW_ALL },
    [LISTING]: { body: '{}' },
    [DETAIL]: { body: '{}' },
  });
}

function cookied(fake: FakeTransport): string[] {
  return fake.calls.filter((call) => call.headers.cookie === COOKIE).map((call) => call.url);
}

function context(session: SourceCredential | null = SESSION): SourceRequestContext {
  return {
    key: 'testsource',
    name: 'Test Source',
    complianceStatus: 'APPROVED_WITH_LIMITS',
    isEnabled: true,
    allowedPaths: ['example.test/api/'],
    minDelayMs: 3_000,
    maxRequestsPerRun: 20,
    session: session ?? undefined,
  };
}

describe('the client decides, not the adapter (R75)', () => {
  it('a plain client never sends the session, even when a request asks for it', async () => {
    const fake = transport();
    const http = testScrapingHttp({ transport: fake, clock });
    const client = http.clientFor(context(), new AbortController().signal);
    await client.get(LISTING, { access: 'signed-in' });
    expect(cookied(fake)).toEqual([]);
    expect(client.signedInRequestsMade).toBe(0);
  });

  it('a targeted view sends it only on a request that asks', async () => {
    const fake = transport();
    const http = testScrapingHttp({ transport: fake, clock });
    const client = http.clientFor(context(), new AbortController().signal).signedInView();
    await client.get(LISTING);
    await client.get(DETAIL, { access: 'signed-in' });
    expect(cookied(fake)).toEqual([DETAIL]);
    // robots.txt never carries it.
    expect(fake.calls.find((call) => call.url === ROBOTS)?.headers.cookie).toBeUndefined();
  });

  it('refuses a sixth signed-in request in one run', async () => {
    const fake = transport();
    const http = testScrapingHttp({ transport: fake, clock, sleep: advancingSleeper() });
    const client = http.clientFor(context(), new AbortController().signal).signedInView();
    for (let index = 0; index < 5; index += 1) {
      await client.get(DETAIL, { access: 'signed-in' });
    }
    await expect(client.get(DETAIL, { access: 'signed-in' })).rejects.toMatchObject({
      refusal: 'SIGNED_IN_BUDGET_SPENT',
    });
    expect(cookied(fake)).toHaveLength(5);
    // The budget is the run's, not the view's: a second view cannot reset it.
    await expect(client.signedInView().get(DETAIL, { access: 'signed-in' })).rejects.toMatchObject({
      refusal: 'SIGNED_IN_BUDGET_SPENT',
    });
  });

  it('spaces two signed-in requests at least ten seconds apart', async () => {
    const fake = transport();
    const sentAt: number[] = [];
    const recording = {
      ...fake,
      fetcher: (request: Parameters<typeof fake.fetcher>[0]) => {
        if (request.headers.cookie === COOKIE) {
          sentAt.push(clock.now().getTime());
        }
        return fake.fetcher(request);
      },
    };
    const http = testScrapingHttp({ transport: recording, clock, sleep: advancingSleeper() });
    const client = http.clientFor(context(), new AbortController().signal).signedInView();
    await client.get(DETAIL, { access: 'signed-in' });
    await client.get(LISTING);
    await client.get(DETAIL, { access: 'signed-in' });
    expect(sentAt).toHaveLength(2);
    expect(sentAt[1]! - sentAt[0]!).toBeGreaterThanOrEqual(10_000);
  });

  it('reads the budget from the source, not from a constant', async () => {
    const fake = transport();
    const http = testScrapingHttp({ transport: fake, clock, sleep: advancingSleeper() });
    const narrow = { ...SESSION, budget: { maxRequests: 1, minIntervalMs: 10_000 } };
    const client = http.clientFor(context(narrow), new AbortController().signal).signedInView();
    await client.get(DETAIL, { access: 'signed-in' });
    await expect(client.get(DETAIL, { access: 'signed-in' })).rejects.toMatchObject({
      refusal: 'SIGNED_IN_BUDGET_SPENT',
    });
  });

  it('falls back to an anonymous read when there is no session', async () => {
    const fake = transport();
    const http = testScrapingHttp({ transport: fake, clock });
    const client = http.clientFor(context(null), new AbortController().signal);
    const response = await client.signedInView().get(DETAIL, { access: 'signed-in' });
    expect(response.status).toBe(200);
    expect(fake.calls.every((call) => call.headers.cookie === undefined)).toBe(true);
  });
});

describe('at run level', () => {
  const verified: number[] = [];
  const hooks: SessionHooks = {
    isActive: () => true,
    expire: () => true,
    verify: (_source, at) => {
      verified.push(at);
    },
    expiredDetail: () => 'expired',
  };

  beforeEach(() => {
    verified.length = 0;
  });

  function deps(fake: FakeTransport): ScrapeRunDependencies {
    return {
      sources: new SourcesRepository(database.db),
      records: new SourceRecordsRepository(database.db),
      http: testScrapingHttp({ transport: fake, clock, sleep: advancingSleeper() }),
      clock,
      logger: silentLogger,
      setupComplete: () => true,
      credentials: () => SESSION,
      sessions: hooks,
    };
  }

  /** An adapter that asks for the session on every request it makes. */
  function greedy(revision: number): SourceAdapter {
    const base = testAdapter({
      items: [listingItem('e1', revision), listingItem('e2', revision)],
      // The candidate moves with the revision, so a second run is an update.
      normalize: (item) =>
        minimalCandidate({
          externalKey: item.externalKey,
          url: item.url,
          title: `Test Hackathon ${revision}`,
          titleRaw: `Test Hackathon ${revision}`,
        }),
    });
    return {
      ...base,
      listing: (ctx) =>
        (async function* walk() {
          await ctx.http.get(LISTING, { access: 'signed-in' });
          yield* base.listing(ctx);
          return { complete: true };
        })(),
      detail: async (ctx, item) => {
        await ctx.http.get(DETAIL, { access: 'signed-in' });
        return { item, payload: item.payload };
      },
    };
  }

  it('a scheduled run sends zero signed-in requests for its listing and new events', async () => {
    const source = insertSource(database.db, { maxRequestsPerRun: 20 });
    const fake = transport();
    const row = await runScrape(deps(fake), { source, adapter: greedy(1), trigger: 'SCHEDULE' });
    expect(row.outcome).toBe('SUCCESS');
    expect(cookied(fake)).toEqual([]);
    // Nothing was signed in, so nothing says the session "last worked".
    expect(verified).toEqual([]);
  });

  it('reads a stored event’s detail page signed in, and records that it worked', async () => {
    const source = insertSource(database.db, { maxRequestsPerRun: 20 });
    await runScrape(deps(transport()), { source, adapter: greedy(1), trigger: 'SCHEDULE' });
    clock.advance(3_600_000);
    const fake = transport();
    await runScrape(deps(fake), { source, adapter: greedy(2), trigger: 'SCHEDULE' });
    // The listing stays anonymous; both changed, stored events' details carry it.
    expect(cookied(fake)).toEqual([DETAIL, DETAIL]);
    expect(verified).toHaveLength(1);
  });

  it('sends none during a catch-up burst', async () => {
    const source = insertSource(database.db, { maxRequestsPerRun: 20 });
    await runScrape(deps(transport()), { source, adapter: greedy(1), trigger: 'SCHEDULE' });
    clock.advance(3_600_000);
    const fake = transport();
    await runScrape(deps(fake), { source, adapter: greedy(2), trigger: 'STARTUP_CATCHUP' });
    expect(cookied(fake)).toEqual([]);
  });

  it('the detail-refresh lane reads stored events signed in, but not after a wake-up', async () => {
    const source = insertSource(database.db, {
      maxRequestsPerRun: 20,
      configJson: '{"maxDetailsPerRun":0}',
    });
    await runScrape(deps(transport()), { source, adapter: greedy(1), trigger: 'SCHEDULE' });
    const records = new SourceRecordsRepository(database.db);
    const runtime = {
      records,
      http: testScrapingHttp({ transport: transport(), clock }),
      clock,
      logger: silentLogger,
      credentials: () => SESSION,
    };

    const catchUp = transport();
    await refreshDetails(
      { ...runtime, http: testScrapingHttp({ transport: catchUp, clock }) },
      source,
      greedy(1),
      10,
      new AbortController().signal,
      'STARTUP_CATCHUP',
    );
    expect(cookied(catchUp)).toEqual([]);

    // The catch-up pass fetched them; owe them again by moving the listing on.
    clock.advance(3_600_000);
    await runScrape(deps(transport()), { source, adapter: greedy(2), trigger: 'SCHEDULE' });
    const scheduled = transport();
    await refreshDetails(
      {
        ...runtime,
        http: testScrapingHttp({ transport: scheduled, clock, sleep: advancingSleeper() }),
      },
      source,
      greedy(2),
      10,
      new AbortController().signal,
      'SCHEDULE',
    );
    expect(cookied(scheduled)).toEqual([DETAIL, DETAIL]);
  });
});

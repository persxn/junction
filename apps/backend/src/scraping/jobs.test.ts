import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog } from '../platform/audit.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { SourcesService } from '../modules/sources/service.js';
import { AdapterRegistry } from '../sources/registry.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';
import {
  fakeTransport,
  insertSource,
  listingItem,
  movableClock,
  silentLogger,
  testAdapter,
  testScrapingHttp,
} from '../testing/scraping.js';
import { DETAIL_REFRESH_INTERVAL_MS, scrapeJobKey, scrapeJobs, detailRefreshJob } from './jobs.js';
import type { RawDetail } from '../sources/types.js';

/**
 * Job registration (R22), and the property that makes WP-09a shippable with no
 * adapter: a `scrape:` job exists only where the registry and the `sources`
 * table agree.
 */

const ROBOTS = 'https://example.test/robots.txt';
const ROBOTS_ALLOW_ALL = 'User-agent: *\nDisallow:\n';

let database: MigratedDatabase;
let clock: ReturnType<typeof movableClock>;
let registry: AdapterRegistry;

beforeEach(() => {
  database = openMigratedDatabase(silentLogger, 'scrape-jobs');
  clock = movableClock('2026-09-21T10:00:00.000Z');
  registry = new AdapterRegistry();
});

afterEach(() => {
  database.close();
});

function service(): SourcesService {
  return new SourcesService({
    sources: new SourcesRepository(database.db),
    records: new SourceRecordsRepository(database.db),
    registry,
    audit: new AuditLog(database.db),
    logger: silentLogger,
    clock,
    runtime: {
      http: testScrapingHttp({
        transport: fakeTransport({ [ROBOTS]: { body: ROBOTS_ALLOW_ALL } }),
        clock,
      }),
      setupComplete: () => true,
    },
  });
}

function deps(sources = service()): Parameters<typeof scrapeJobs>[0] {
  return {
    sources,
    registry,
    runtime: {
      records: new SourceRecordsRepository(database.db),
      http: testScrapingHttp({
        transport: fakeTransport({ [ROBOTS]: { body: ROBOTS_ALLOW_ALL } }),
        clock,
      }),
      clock,
      logger: silentLogger,
    },
    logger: silentLogger,
  };
}

describe('registration (R22)', () => {
  it('registers no scrape job while the adapter registry is empty', () => {
    // The seven seeded rows are all there, and CTFtime is even enabled and
    // approved — but nothing can run it, so nothing is scheduled.
    expect(new SourcesRepository(database.db).list()).toHaveLength(7);
    expect(scrapeJobs(deps())).toEqual([]);
  });

  it('registers a job the moment an adapter and an enabled approved row meet', () => {
    const source = insertSource(database.db, { key: 'demo', cadenceMinutes: 20 });
    registry.register(testAdapter({ key: 'demo' }));
    const jobs = scrapeJobs(deps());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      key: scrapeJobKey('demo'),
      kind: 'SCRAPE',
      intervalMs: 20 * 60_000,
      requiresNetwork: true,
    });
    expect(source.key).toBe('demo');
  });

  it.each([
    ['disabled', { isEnabled: false }],
    ['MANUAL_IMPORT_ONLY', { complianceStatus: 'MANUAL_IMPORT_ONLY' as const }],
    ['PENDING_REVIEW', { complianceStatus: 'PENDING_REVIEW' as const }],
  ])('registers no job for a %s source, even with an adapter', (_label, overrides) => {
    insertSource(database.db, { key: 'demo', ...overrides });
    registry.register(testAdapter({ key: 'demo' }));
    expect(scrapeJobs(deps())).toEqual([]);
  });

  it('always registers detail-refresh, on D-27’s cycle', () => {
    const job = detailRefreshJob(deps());
    expect(job).toMatchObject({
      key: 'detail-refresh',
      kind: 'SCRAPE',
      intervalMs: DETAIL_REFRESH_INTERVAL_MS,
      requiresNetwork: true,
      firstRun: 'after-interval',
    });
    expect(DETAIL_REFRESH_INTERVAL_MS).toBe(15 * 60_000);
  });

  it('refuses two adapters for one source key', () => {
    registry.register(testAdapter({ key: 'demo' }));
    expect(() => {
      registry.register(testAdapter({ key: 'demo' }));
    }).toThrow(/already registered/);
  });
});

describe('the scrape job body', () => {
  it('re-reads the source, so a row disabled since registration does not run', async () => {
    const source = insertSource(database.db, { key: 'demo' });
    registry.register(testAdapter({ key: 'demo', items: [listingItem('a')] }));
    const jobs = scrapeJobs(deps());
    new SourcesRepository(database.db).update(
      source.id,
      { isEnabled: false },
      source.version,
      clock.now().getTime(),
    );
    const result = await jobs[0]?.run({
      key: scrapeJobKey('demo'),
      trigger: 'SCHEDULE',
      attempt: 1,
      signal: new AbortController().signal,
      logger: silentLogger,
      clock,
      state: {
        jobKey: scrapeJobKey('demo'),
        kind: 'SCRAPE',
        lastRunAt: null,
        lastSuccessAt: null,
        nextDueAt: 0,
        runningSince: null,
        consecutiveFailures: 0,
        backoffUntil: null,
        lastOutcome: null,
        lastDurationMs: null,
        lastErrorMessage: null,
      },
    });
    expect(result).toMatchObject({ outcome: 'SKIPPED_OFFLINE' });
  });
});

describe('detail-refresh (§7.2)', () => {
  it('picks up exactly the records whose detail fetch was owed', async () => {
    const source = insertSource(database.db, {
      key: 'demo',
      // One request for the listing; anything else is owed to the next pass.
      maxRequestsPerRun: 1,
      configJson: JSON.stringify({ maxDetailsPerRun: 0 }),
    });
    const detail = (): Promise<RawDetail> =>
      Promise.resolve({ item: listingItem('a'), payload: { externalKey: 'a', revision: 99 } });
    registry.register(
      testAdapter({ key: 'demo', items: [listingItem('a'), listingItem('b')], detail }),
    );

    const sources = service();
    await sources.run(source, 'SCHEDULE');

    const records = new SourceRecordsRepository(database.db);
    // Both were seen, and both are owed a detail fetch they did not get.
    expect(records.awaitingDetail(source.id, 10)).toHaveLength(2);

    clock.advance(20 * 60_000);
    const job = detailRefreshJob(deps(sources));
    const result = await job.run({
      key: 'detail-refresh',
      trigger: 'SCHEDULE',
      attempt: 1,
      signal: new AbortController().signal,
      logger: silentLogger,
      clock,
      state: {
        jobKey: 'detail-refresh',
        kind: 'SCRAPE',
        lastRunAt: null,
        lastSuccessAt: null,
        nextDueAt: 0,
        runningSince: null,
        consecutiveFailures: 0,
        backoffUntil: null,
        lastOutcome: null,
        lastDurationMs: null,
        lastErrorMessage: null,
      },
    });
    expect(result).toMatchObject({ outcome: 'SUCCESS' });
    expect(records.awaitingDetail(source.id, 10)).toHaveLength(0);
  });

  it('does nothing, cheaply, when nothing is owed', async () => {
    insertSource(database.db, { key: 'demo' });
    registry.register(testAdapter({ key: 'demo' }));
    const job = detailRefreshJob(deps());
    const result = await job.run({
      key: 'detail-refresh',
      trigger: 'SCHEDULE',
      attempt: 1,
      signal: new AbortController().signal,
      logger: silentLogger,
      clock,
      state: {
        jobKey: 'detail-refresh',
        kind: 'SCRAPE',
        lastRunAt: null,
        lastSuccessAt: null,
        nextDueAt: 0,
        runningSince: null,
        consecutiveFailures: 0,
        backoffUntil: null,
        lastOutcome: null,
        lastDurationMs: null,
        lastErrorMessage: null,
      },
    });
    expect(result).toMatchObject({ outcome: 'SUCCESS', detail: 'nothing owed' });
  });

  it('writes no scrape_runs row: it is not a listing run (§7.6)', async () => {
    const source = insertSource(database.db, {
      key: 'demo',
      configJson: JSON.stringify({ maxDetailsPerRun: 0 }),
    });
    registry.register(
      testAdapter({
        key: 'demo',
        items: [listingItem('a')],
        detail: () =>
          Promise.resolve({ item: listingItem('a'), payload: { externalKey: 'a', revision: 2 } }),
      }),
    );
    const sources = service();
    await sources.run(source, 'SCHEDULE');
    const runsBefore = new SourcesRepository(database.db).runs(source.id).length;

    clock.advance(20 * 60_000);
    await detailRefreshJob(deps(sources)).run({
      key: 'detail-refresh',
      trigger: 'SCHEDULE',
      attempt: 1,
      signal: new AbortController().signal,
      logger: silentLogger,
      clock,
      state: {
        jobKey: 'detail-refresh',
        kind: 'SCRAPE',
        lastRunAt: null,
        lastSuccessAt: null,
        nextDueAt: 0,
        runningSince: null,
        consecutiveFailures: 0,
        backoffUntil: null,
        lastOutcome: null,
        lastDurationMs: null,
        lastErrorMessage: null,
      },
    });
    expect(new SourcesRepository(database.db).runs(source.id)).toHaveLength(runsBefore);
  });
});

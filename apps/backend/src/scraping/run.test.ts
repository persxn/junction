import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scrapeRuns, sourceRecords, type SourceRow } from '../db/schema/index.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';
import {
  fakeTransport,
  insertSource,
  listingItem,
  movableClock,
  silentLogger,
  testAdapter,
  testScrapingHttp,
  type FakeTransport,
} from '../testing/scraping.js';
import { toStatus } from '../modules/sources/mappers.js';
import { AdapterFormatError } from './errors.js';
import { TransportError } from './http/index.js';
import { runScrape, type ScrapeRunDependencies } from './run.js';

/**
 * The orchestrator, against a real migrated database and a fake transport.
 *
 * A real database because half of what is being tested *is* the database: the
 * unique index on (source_id, external_key), the CHECK constraints on the
 * outcome and error-kind enums, and the correlated subquery §7.6 is implemented
 * as. A fake transport because R60 says every one of the failure modes below is
 * proved without a live call.
 */

const ROBOTS = 'https://example.test/robots.txt';
const LISTING = 'https://example.test/api/listing';
const ROBOTS_ALLOW_ALL = 'User-agent: *\nDisallow:\n';

let database: MigratedDatabase;
let clock: ReturnType<typeof movableClock>;

beforeEach(() => {
  database = openMigratedDatabase(silentLogger, 'scrape-run');
  clock = movableClock('2026-09-21T10:00:00.000Z');
});

afterEach(() => {
  database.close();
});

function deps(
  transport: FakeTransport,
  options: { online?: boolean; setupComplete?: boolean } = {},
): ScrapeRunDependencies {
  return {
    sources: new SourcesRepository(database.db),
    records: new SourceRecordsRepository(database.db),
    http: testScrapingHttp({
      transport,
      clock,
      ...(options.online === undefined ? {} : { online: options.online }),
      ...(options.setupComplete === undefined ? {} : { setupComplete: options.setupComplete }),
    }),
    clock,
    logger: silentLogger,
    setupComplete: () => options.setupComplete ?? true,
  };
}

const ALLOWING_TRANSPORT = (): FakeTransport =>
  fakeTransport({ [ROBOTS]: { body: ROBOTS_ALLOW_ALL }, [LISTING]: { body: '{}' } });

/**
 * The §7.7 sentence Source status would show for this source right now. The
 * failure-mode cases assert it next to the `scrape_runs` row, because an
 * `error_kind` nobody can read is half a feature.
 */
function messageFor(dependencies: ScrapeRunDependencies, source: SourceRow): string {
  const now = clock.now().getTime();
  return toStatus({
    source,
    state: dependencies.sources.state(source.id, now),
    latestRun: dependencies.sources.latestRun(source.id),
    now,
  }).message;
}

function runsOf(source: SourceRow): readonly (typeof scrapeRuns.$inferSelect)[] {
  return database.db.drizzle
    .select()
    .from(scrapeRuns)
    .all()
    .filter((row) => row.sourceId === source.id);
}

describe('the compliance gate, at run level', () => {
  it.each(['MANUAL_IMPORT_ONLY', 'PENDING_REVIEW', 'BLOCKED'] as const)(
    'records %s as BLOCKED_BY_POLICY with zero requests (R60)',
    async (complianceStatus) => {
      const transport = ALLOWING_TRANSPORT();
      const source = insertSource(database.db, { complianceStatus });
      const dependencies = deps(transport);
      const run = await runScrape(dependencies, {
        source,
        adapter: testAdapter({ fetches: [LISTING] }),
        trigger: 'SCHEDULE',
      });
      expect(run.outcome).toBe('BLOCKED_BY_POLICY');
      expect(run.errorKind).toBe('BLOCKED');
      expect(run.requestsMade).toBe(0);
      expect(transport.calls).toHaveLength(0);
      expect(messageFor(dependencies, source)).toContain('disabled by policy');
    },
  );

  it('records a disabled source as BLOCKED_BY_POLICY with zero requests', async () => {
    const transport = ALLOWING_TRANSPORT();
    const source = insertSource(database.db, { isEnabled: false });
    const run = await runScrape(deps(transport), {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('BLOCKED_BY_POLICY');
    expect(transport.calls).toHaveLength(0);
  });

  it('makes no request while setup is unfinished (A10/R44)', async () => {
    const transport = ALLOWING_TRANSPORT();
    const source = insertSource(database.db);
    const run = await runScrape(deps(transport, { setupComplete: false }), {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('BLOCKED_BY_POLICY');
    expect(run.errorDetail).toContain('contact e-mail');
    expect(transport.calls).toHaveLength(0);
  });
});

describe('offline and backoff (D-23, R59)', () => {
  it('records SKIPPED_OFFLINE and leaves the failure streak alone', async () => {
    const transport = ALLOWING_TRANSPORT();
    const source = insertSource(database.db);
    const dependencies = deps(transport, { online: false });
    const run = await runScrape(dependencies, {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('SKIPPED_OFFLINE');
    expect(run.errorKind).toBeNull();
    expect(transport.calls).toHaveLength(0);
    expect(messageFor(dependencies, source)).toContain("You're offline");
    const state = dependencies.sources.state(source.id, clock.now().getTime());
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastRunAt).toBeNull();
  });

  it('records SKIPPED_BACKOFF while the ladder is still running', async () => {
    const transport = ALLOWING_TRANSPORT();
    const source = insertSource(database.db);
    const dependencies = deps(transport);
    dependencies.sources.state(source.id, clock.now().getTime());
    dependencies.sources.recordFailure(
      source.id,
      clock.now().getTime(),
      clock.now().getTime() + 15 * 60_000,
      'TIMEOUT',
      'earlier failure',
      1,
    );
    const run = await runScrape(dependencies, {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('SKIPPED_BACKOFF');
    expect(transport.calls).toHaveLength(0);
  });

  it('climbs 15 → 30 → 60 → … → 720 minutes and stops there', async () => {
    const source = insertSource(database.db);
    const dependencies = deps(fakeTransport({ [ROBOTS]: { body: ROBOTS_ALLOW_ALL } }));
    const minutes: number[] = [];

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const before = clock.now().getTime();
      const run = await runScrape(dependencies, {
        source,
        adapter: testAdapter({ throwsBeforeItems: new TransportError('TIMEOUT', 'nope') }),
        trigger: 'SCHEDULE',
      });
      expect(run.outcome).toBe('FAILED');
      const state = dependencies.sources.state(source.id, before);
      minutes.push(Math.round(((state.backoffUntil ?? 0) - before) / 60_000));
      // Step past the backoff so the next run is not SKIPPED_BACKOFF.
      clock.advance((state.backoffUntil ?? 0) - before + 1);
    }

    expect(minutes).toEqual([15, 30, 60, 120, 240, 480, 720, 720]);
  });

  it('clears the streak and the backoff on the first success', async () => {
    const source = insertSource(database.db);
    const dependencies = deps(ALLOWING_TRANSPORT());
    await runScrape(dependencies, {
      source,
      adapter: testAdapter({ throwsBeforeItems: new TransportError('TIMEOUT', 'nope') }),
      trigger: 'SCHEDULE',
    });
    expect(dependencies.sources.state(source.id, 0).consecutiveFailures).toBe(1);

    clock.advance(30 * 60_000);
    const run = await runScrape(dependencies, {
      source,
      adapter: testAdapter({ items: [listingItem('a')] }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('SUCCESS');
    const state = dependencies.sources.state(source.id, 0);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.backoffUntil).toBeNull();
    expect(state.lastSuccessAt).not.toBeNull();
  });
});

describe('failure modes that reach the transport', () => {
  it('reports a robots disallow as BLOCKED_BY_POLICY with no page request', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: 'User-agent: *\nDisallow: /api/\n' },
      [LISTING]: { body: '{}' },
    });
    const source = insertSource(database.db);
    const dependencies = deps(transport);
    const run = await runScrape(dependencies, {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('BLOCKED_BY_POLICY');
    expect(run.errorKind).toBe('ROBOTS_DISALLOWED');
    expect(transport.countFor(LISTING)).toBe(0);
    expect(messageFor(dependencies, source)).toContain('disabled by policy');
  });

  it.each([
    ['a timeout', 'TIMEOUT' as const],
    ['a TLS failure', 'TLS' as const],
  ])('records %s as FAILED with that error kind', async (_label, kind) => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [LISTING]: { throws: kind },
    });
    const source = insertSource(database.db);
    const dependencies = deps(transport);
    const run = await runScrape(dependencies, {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('FAILED');
    expect(run.errorKind).toBe(kind);
    expect(messageFor(dependencies, source)).toContain(
      kind === 'TLS' ? 'so it is skipped' : "Couldn't reach",
    );
  });

  it('records a 403 as FAILED/BLOCKED after one attempt with one User-Agent', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [LISTING]: { status: 403 },
    });
    const source = insertSource(database.db);
    const dependencies = deps(transport);
    const run = await runScrape(dependencies, {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('FAILED');
    expect(run.errorKind).toBe('BLOCKED');
    expect(transport.countFor(LISTING)).toBe(1);
    expect(new Set(transport.calls.map((call) => call.headers['user-agent'])).size).toBe(1);
    expect(messageFor(dependencies, source)).toContain('refuses automated readers');
  });

  it('records a 5xx as FAILED after the retries, and counts every attempt', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [LISTING]: { status: 500 },
    });
    const source = insertSource(database.db);
    const dependencies = deps(transport);
    const run = await runScrape(dependencies, {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('FAILED');
    expect(run.errorKind).toBe('HTTP_5XX');
    expect(run.requestsMade).toBe(3);
    expect(messageFor(dependencies, source)).toContain("Couldn't reach");
  });

  it('records a 429 with Retry-After as RATE_LIMITED when it does not fit', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [LISTING]: { status: 429, headers: { 'retry-after': '7200' } },
    });
    const source = insertSource(database.db);
    const dependencies = deps(transport);
    const run = await runScrape(dependencies, {
      source,
      adapter: testAdapter({ fetches: [LISTING] }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('FAILED');
    expect(run.errorKind).toBe('RATE_LIMITED');
    expect(messageFor(dependencies, source)).toContain('asked us to slow down');
  });

  it('pauses the source on a format change, with no records written (§7.7)', async () => {
    const transport = ALLOWING_TRANSPORT();
    const source = insertSource(database.db);
    const dependencies = deps(transport);
    const run = await runScrape(dependencies, {
      source,
      adapter: testAdapter({
        throwsBeforeItems: new AdapterFormatError('SCHEMA_CHANGED', 'the listing lost its shape'),
      }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('FAILED');
    expect(run.errorKind).toBe('SCHEMA_CHANGED');
    expect(database.db.drizzle.select().from(sourceRecords).all()).toHaveLength(0);
    const paused = dependencies.sources.findById(source.id);
    expect(paused?.isEnabled).toBe(false);
    expect(messageFor(dependencies, paused ?? source)).toContain('page format changed');
  });

  it('refuses to run again once it has been paused', async () => {
    const transport = ALLOWING_TRANSPORT();
    const source = insertSource(database.db);
    const dependencies = deps(transport);
    await runScrape(dependencies, {
      source,
      adapter: testAdapter({ throwsBeforeItems: new AdapterFormatError('PARSE', 'nope') }),
      trigger: 'SCHEDULE',
    });
    const paused = dependencies.sources.findById(source.id);
    expect(paused).toBeDefined();
    clock.advance(24 * 3_600_000);
    const second = await runScrape(dependencies, {
      source: paused ?? source,
      adapter: testAdapter({ items: [listingItem('a')] }),
      trigger: 'SCHEDULE',
    });
    expect(second.outcome).toBe('BLOCKED_BY_POLICY');
  });
});

describe('items (§7)', () => {
  it('writes four records and counts one invalid, and the run is a success', async () => {
    const source = insertSource(database.db);
    const dependencies = deps(ALLOWING_TRANSPORT());
    const items = ['a', 'b', 'bad', 'c', 'd'].map((key) => listingItem(key));
    const run = await runScrape(dependencies, {
      source,
      adapter: testAdapter({
        items,
        // R50 in action: a candidate carrying a people field fails `.strict()`.
        normalize: (item) =>
          item.externalKey === 'bad'
            ? { sourceKey: 'testsource', externalKey: 'bad', participants: ['someone'] }
            : undefined,
      }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('SUCCESS');
    expect(run.itemsSeen).toBe(5);
    expect(run.itemsNew).toBe(4);
    expect(run.itemsInvalid).toBe(1);
    expect(database.db.drizzle.select().from(sourceRecords).all()).toHaveLength(4);
  });

  it('counts an unchanged item as unchanged on the second run', async () => {
    const source = insertSource(database.db);
    const dependencies = deps(ALLOWING_TRANSPORT());
    const adapter = testAdapter({ items: [listingItem('a'), listingItem('b')] });
    const first = await runScrape(dependencies, { source, adapter, trigger: 'SCHEDULE' });
    expect(first.itemsNew).toBe(2);

    clock.advance(30 * 60_000);
    const second = await runScrape(dependencies, {
      source,
      adapter: testAdapter({ items: [listingItem('a'), listingItem('b')] }),
      trigger: 'SCHEDULE',
    });
    expect(second.itemsUnchanged).toBe(2);
    expect(second.itemsNew).toBe(0);
    expect(second.itemsUpdated).toBe(0);
  });

  it('counts a changed item as updated', async () => {
    const source = insertSource(database.db);
    const dependencies = deps(ALLOWING_TRANSPORT());
    await runScrape(dependencies, {
      source,
      adapter: testAdapter({ items: [listingItem('a', 1)] }),
      trigger: 'SCHEDULE',
    });
    clock.advance(30 * 60_000);
    const second = await runScrape(dependencies, {
      source,
      adapter: testAdapter({
        items: [listingItem('a', 2)],
        normalize: (item) => ({
          sourceKey: 'testsource',
          externalKey: item.externalKey,
          url: item.url,
          title: 'Renamed',
          titleRaw: 'Renamed',
          eventType: { value: 'HACKATHON', confidence: 1 },
          mode: { value: 'ONLINE', confidence: 1 },
          isRecurringRound: false,
          warnings: [],
        }),
      }),
      trigger: 'SCHEDULE',
    });
    expect(second.itemsUpdated).toBe(1);
  });

  it('leaves event_id null — matching is WP-10’s', async () => {
    const source = insertSource(database.db);
    await runScrape(deps(ALLOWING_TRANSPORT()), {
      source,
      adapter: testAdapter({ items: [listingItem('a')] }),
      trigger: 'SCHEDULE',
    });
    const rows = database.db.drizzle.select().from(sourceRecords).all();
    expect(rows.every((row) => row.eventId === null)).toBe(true);
    expect(rows.every((row) => row.matchMethod === 'NEW')).toBe(true);
  });

  it('is PARTIAL when the adapter did not walk the whole listing (A8, §7.6)', async () => {
    const source = insertSource(database.db);
    const run = await runScrape(deps(ALLOWING_TRANSPORT()), {
      source,
      adapter: testAdapter({ items: [listingItem('a')], complete: false }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('PARTIAL');
    expect(run.listingComplete).toBe(false);
  });

  it('is PARTIAL, not FAILED, when a failure arrives after items have landed', async () => {
    const source = insertSource(database.db);
    const run = await runScrape(deps(ALLOWING_TRANSPORT()), {
      source,
      adapter: testAdapter({
        items: [listingItem('a'), listingItem('b')],
        throwAfter: 1,
        throwsAfterItems: new TransportError('NETWORK', 'the second page died'),
      }),
      trigger: 'SCHEDULE',
    });
    expect(run.outcome).toBe('PARTIAL');
    expect(run.errorKind).toBe('NETWORK');
    expect(run.listingComplete).toBe(false);
    expect(database.db.drizzle.select().from(sourceRecords).all()).toHaveLength(1);
  });
});

describe('lifecycle: MISSING (§7.6)', () => {
  async function completeRunWithout(source: SourceRow, keys: readonly string[]): Promise<void> {
    clock.advance(30 * 60_000);
    await runScrape(deps(ALLOWING_TRANSPORT()), {
      source,
      adapter: testAdapter({ items: keys.map((key) => listingItem(key)) }),
      trigger: 'SCHEDULE',
    });
  }

  it('marks a record MISSING after exactly three complete runs without it', async () => {
    const source = insertSource(database.db);
    const records = new SourceRecordsRepository(database.db);
    await completeRunWithout(source, ['a', 'gone']);
    expect(records.find(source.id, 'gone')?.presence).toBe('LISTED');

    await completeRunWithout(source, ['a']);
    expect(records.find(source.id, 'gone')?.presence).toBe('LISTED');
    await completeRunWithout(source, ['a']);
    expect(records.find(source.id, 'gone')?.presence).toBe('LISTED');

    await completeRunWithout(source, ['a']);
    const missing = records.find(source.id, 'gone');
    expect(missing?.presence).toBe('MISSING');
    expect(missing?.missingSince).not.toBeNull();
  });

  it('never counts a PARTIAL run towards MISSING', async () => {
    const source = insertSource(database.db);
    const records = new SourceRecordsRepository(database.db);
    await completeRunWithout(source, ['a', 'gone']);

    // Three partial runs in a row: still LISTED.
    for (let index = 0; index < 3; index += 1) {
      clock.advance(30 * 60_000);
      await runScrape(deps(ALLOWING_TRANSPORT()), {
        source,
        adapter: testAdapter({ items: [listingItem('a')], complete: false }),
        trigger: 'SCHEDULE',
      });
    }
    expect(records.find(source.id, 'gone')?.presence).toBe('LISTED');

    // Now three complete ones, with a partial in between for good measure.
    await completeRunWithout(source, ['a']);
    clock.advance(30 * 60_000);
    await runScrape(deps(ALLOWING_TRANSPORT()), {
      source,
      adapter: testAdapter({ items: [listingItem('a')], complete: false }),
      trigger: 'SCHEDULE',
    });
    await completeRunWithout(source, ['a']);
    expect(records.find(source.id, 'gone')?.presence).toBe('LISTED');
    await completeRunWithout(source, ['a']);
    expect(records.find(source.id, 'gone')?.presence).toBe('MISSING');
  });

  it('brings a record back to LISTED the moment the source lists it again', async () => {
    const source = insertSource(database.db);
    const records = new SourceRecordsRepository(database.db);
    await completeRunWithout(source, ['a', 'gone']);
    for (let index = 0; index < 3; index += 1) {
      await completeRunWithout(source, ['a']);
    }
    expect(records.find(source.id, 'gone')?.presence).toBe('MISSING');

    await completeRunWithout(source, ['a', 'gone']);
    const back = records.find(source.id, 'gone');
    expect(back?.presence).toBe('LISTED');
    expect(back?.missingSince).toBeNull();
  });

  it('never cancels anything: MISSING is the strongest thing a run may say', async () => {
    const source = insertSource(database.db);
    const records = new SourceRecordsRepository(database.db);
    await completeRunWithout(source, ['gone']);
    for (let index = 0; index < 4; index += 1) {
      await completeRunWithout(source, []);
    }
    const row = records.find(source.id, 'gone');
    expect(row?.presence).toBe('MISSING');
    // The candidate is untouched: nothing in the pipeline may claim a source
    // said "cancelled" when all it did was stop listing it.
    expect(JSON.parse(row?.payloadJson ?? '{}')).toMatchObject({ externalKey: 'gone' });
  });
});

describe('the run row itself', () => {
  it('records a duration, a trigger and the requests it made', async () => {
    const source = insertSource(database.db);
    const transport = ALLOWING_TRANSPORT();
    const run = await runScrape(deps(transport), {
      source,
      adapter: testAdapter({ items: [listingItem('a')], fetches: [LISTING] }),
      trigger: 'MANUAL',
    });
    expect(run.trigger).toBe('MANUAL');
    expect(run.requestsMade).toBe(1);
    expect(run.durationMs).not.toBeNull();
    expect(run.finishedAt).not.toBeNull();
    expect(runsOf(source)).toHaveLength(1);
  });

  it('never leaves a run open, even when the adapter threw', async () => {
    const source = insertSource(database.db);
    await runScrape(deps(ALLOWING_TRANSPORT()), {
      source,
      adapter: testAdapter({ throwsBeforeItems: new Error('an adapter bug') }),
      trigger: 'SCHEDULE',
    });
    const [row] = runsOf(source);
    expect(row?.finishedAt).not.toBeNull();
    // An unexpected throw is UNKNOWN, not a network problem it never had.
    expect(row?.errorKind).toBe('UNKNOWN');
  });
});

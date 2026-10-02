import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { effectiveDelayMs } from '../../domain/scraping/gate.js';
import { parseRobots, ScrapeRequestError } from '../../scraping/http/index.js';
import { runScrape } from '../../scraping/run.js';
import { sourceRequestContext } from '../../scraping/source-row.js';
import { CTFTIME_CAPTURE_CLOCK, ctftimeFixture } from '../../testing/ctftime.js';
import {
  CTFTIME_ROBOTS_URL,
  detailRoutes,
  firstListingUrl,
  openCtftimeRun,
  recordedCtftimeRobots,
  recordedTransport,
  type CtftimeRunHarness,
} from '../../testing/ctftime-run.js';
import { fakeTransport } from '../../testing/scraping.js';

/**
 * CTFtime end to end on the fake transport (WP-09b TESTS): the seeded source
 * row, the real adapter, WP-09a's orchestrator, a real migrated database.
 * Offline by construction — the transport answers only the URLs listed here.
 */

const clock = CTFTIME_CAPTURE_CLOCK;
let h: CtftimeRunHarness;

beforeEach(() => {
  h = openCtftimeRun(clock);
});

afterEach(() => {
  h.close();
});

/** `/api/v1/events/?…` or `/api/v1/events/{id}/` on ctftime.org, and nothing else. */
const DOCUMENTED_PATH = /^https:\/\/ctftime\.org\/api\/v1\/events\/(?:\?[^/]*|\d+\/)$/;

const run = (transport: ReturnType<typeof recordedTransport>) =>
  runScrape(h.deps(transport), { source: h.source, adapter: h.adapter, trigger: 'MANUAL' });

describe('the seeded ctftime row agrees with what the run uses (D-26, D-27, D-32)', () => {
  it('is approved with limits, 30 min / 10 min floor, 10 s, 6 requests, the two API paths', () => {
    expect(h.source).toMatchObject({
      complianceStatus: 'APPROVED_WITH_LIMITS',
      isEnabled: true,
      cadenceMinutes: 30,
      manualMinIntervalMinutes: 10,
      minDelayMs: 10_000,
      maxRequestsPerRun: 6,
      attributionText: 'Event data from CTFtime (ctftime.org)',
    });
    expect(JSON.parse(h.source.allowedPathsJson)).toEqual([
      'ctftime.org/api/v1/events/$',
      'ctftime.org/api/v1/events/{id}/$',
    ]);
    expect(h.adapter.defaultCadenceMinutes).toBe(h.source.cadenceMinutes);
    expect(h.adapter.key).toBe(h.source.key);
    expect(JSON.parse(h.source.configJson)).toMatchObject({ listingLimit: 100 });
  });

  it('never feeds model training: the notes carry ai-train=no', () => {
    expect(h.source.complianceNotes).toContain('ai-train=no');
  });
});

describe('a whole run, end to end', () => {
  it('first run: complete, every event new, one gzipped snapshot per record', async () => {
    const transport = recordedTransport(clock);
    const row = await run(transport);

    expect(row).toMatchObject({
      outcome: 'SUCCESS',
      listingComplete: true,
      itemsSeen: 5,
      itemsNew: 5,
      itemsInvalid: 0,
      errorKind: null,
    });
    // `detailPolicy: 'never'` (pre-M2b): the listing carries every field, so
    // the run is that one request — it was six, five of them redundant details.
    expect(row.requestsMade).toBe(1);

    const records = h.deps(transport).records.list(h.source.id);
    expect(records).toHaveLength(5);
    // …and `detail-refresh` owes it nothing afterwards.
    expect(h.deps(transport).records.awaitingDetail(h.source.id, 10)).toEqual([]);
    const monthDir = path.join(h.snapshots.root, 'ctftime', '2026-09');
    const files = readdirSync(monthDir).filter((name) => name.endsWith('.json.gz'));
    for (const record of records) {
      expect(record.rawSnapshotRef, record.externalKey).toMatch(/^ctftime\/2026-09\/.+\.json\.gz$/);
      expect(files).toContain(path.posix.basename(record.rawSnapshotRef ?? ''));
    }
    expect(files).toHaveLength(5);
  });

  it('re-run: the same listing is every item unchanged, and no detail is fetched', async () => {
    await run(recordedTransport(clock));
    const transport = recordedTransport(clock);
    const second = await run(transport);
    expect(second).toMatchObject({
      outcome: 'SUCCESS',
      listingComplete: true,
      itemsSeen: 5,
      itemsNew: 0,
      itemsUpdated: 0,
      itemsUnchanged: 5,
      requestsMade: 1,
    });
    // Each harness client is fresh, so robots.txt is read again; the adapter's
    // own requests are the listing and nothing else.
    const adapterCalls = transport.calls
      .map((call) => call.url)
      .filter((url) => url !== CTFTIME_ROBOTS_URL);
    expect(adapterCalls).toEqual([firstListingUrl(clock)]);
  });
});

describe('only the two documented paths are ever requested', () => {
  it('a whole run touches /api/v1/events/ and /api/v1/events/{id}/ and robots.txt only', async () => {
    const transport = recordedTransport(clock);
    await run(transport);
    const urls = transport.calls.map((call) => call.url);
    expect(urls.length).toBeGreaterThan(1);
    for (const url of urls) {
      // robots.txt is the client's own precondition (§7.2), not an adapter request.
      if (url === CTFTIME_ROBOTS_URL) {
        continue;
      }
      expect(url).toMatch(DOCUMENTED_PATH);
    }
    expect(urls.filter((url) => url === CTFTIME_ROBOTS_URL)).toHaveLength(1);
  });

  it.each([
    'https://ctftime.org/event/3417/',
    'https://ctftime.org/export/events/',
    'https://ctftime.org/login/',
    'https://ctftime.org/api/v1/teams/',
    'https://ctftime.org/api/v1/events/3417/extra/',
    'https://scan.sx/',
  ])('any other path (%s) is refused by the gate with zero requests', async (url) => {
    const transport = recordedTransport(clock);
    const client = h
      .deps(transport)
      .http.clientFor(sourceRequestContext(h.source), new AbortController().signal);
    const refused = await client.get(url).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ScrapeRequestError);
    expect((refused as ScrapeRequestError).refusal).toBeDefined();
    expect(transport.calls).toHaveLength(0);
  });
});

describe('the delay comes from robots.txt (A9, D-28)', () => {
  it('the effective delay equals the recorded Crawl-delay and is at least 10 s', async () => {
    const robots = parseRobots(CTFTIME_ROBOTS_URL, recordedCtftimeRobots(), 0);
    const crawlDelay = robots.crawlDelaySeconds;
    expect(crawlDelay).toBeDefined();
    const expected = (crawlDelay ?? 0) * 1000;

    const delay = effectiveDelayMs(h.source.minDelayMs, crawlDelay);
    expect(delay).toBe(expected);
    expect(delay).toBeGreaterThanOrEqual(10_000);

    // And the runs really waited it: the clock is frozen, so every request after
    // the first on the host sleeps the whole delay — robots.txt, then the
    // listing, once per run (a run is one request since `detailPolicy: 'never'`).
    await run(recordedTransport(clock));
    await run(recordedTransport(clock));
    const politeWaits = h.sleep.waits.filter((ms) => ms > 0);
    expect(politeWaits.length).toBeGreaterThanOrEqual(2);
    for (const wait of politeWaits) {
      expect(wait).toBe(expected);
    }
  });

  it('the User-Agent carries the contact e-mail on every request', async () => {
    const transport = recordedTransport(clock);
    await run(transport);
    for (const call of transport.calls) {
      expect(call.headers['user-agent']).toBe('CompIntel/1.2.3 (+mailto:tech.office@example.edu)');
    }
  });
});

describe('isolation and breakage', () => {
  it('invalid-dates.json: one item invalid, its neighbour stored, the run still SUCCESS', async () => {
    const events = ctftimeFixture('invalid-dates.json') as unknown[];
    const transport = fakeTransport({
      [CTFTIME_ROBOTS_URL]: { body: recordedCtftimeRobots() },
      [firstListingUrl(clock)]: { body: JSON.stringify(events) },
      ...detailRoutes(events),
    });
    const row = await run(transport);
    expect(row).toMatchObject({
      outcome: 'SUCCESS',
      listingComplete: true,
      itemsSeen: 2,
      itemsNew: 1,
      itemsInvalid: 1,
    });
    const keys = h
      .deps(transport)
      .records.list(h.source.id)
      .map((record) => record.externalKey);
    expect(keys).toEqual(['900202']);
  });

  it('HTML where JSON is expected: SCHEMA_CHANGED, paused, no records, the body kept', async () => {
    const html = '<!doctype html><html><body><h1>Maintenance</h1></body></html>';
    const transport = recordedTransport(clock, {
      body: html,
      headers: { 'content-type': 'text/html' },
    });
    const row = await run(transport);

    expect(row).toMatchObject({
      outcome: 'FAILED',
      errorKind: 'SCHEMA_CHANGED',
      listingComplete: false,
      itemsSeen: 0,
      requestsMade: 1,
    });
    expect(h.deps(transport).records.list(h.source.id)).toHaveLength(0);
    const sources = h.deps(transport).sources;
    expect(sources.findByKey('ctftime')?.isEnabled).toBe(false);
    expect(sources.state(h.source.id, clock.now().getTime()).consecutiveFailures).toBe(1);

    const monthDir = path.join(h.snapshots.root, 'ctftime', '2026-09');
    expect(existsSync(monthDir)).toBe(true);
    const kept = readdirSync(monthDir).filter((name) => name.startsWith('format-failure-'));
    expect(kept).toHaveLength(1);
    expect(statSync(path.join(monthDir, kept[0]!)).size).toBeGreaterThan(0);
  });

  it('JSON that lost a required key is SCHEMA_CHANGED too, and writes nothing', async () => {
    const events = (ctftimeFixture('listing-events.json') as Record<string, unknown>[]).map(
      ({ start: _start, ...rest }) => rest,
    );
    const transport = recordedTransport(clock, { body: JSON.stringify(events) });
    const row = await run(transport);
    expect(row.errorKind).toBe('SCHEMA_CHANGED');
    expect(row.errorDetail).toContain('start');
    expect(h.deps(transport).records.list(h.source.id)).toHaveLength(0);
  });
});

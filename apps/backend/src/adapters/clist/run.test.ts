import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { effectiveDelayMs } from '../../domain/scraping/gate.js';
import { ScrapeRequestError } from '../../scraping/http/index.js';
import { runScrape } from '../../scraping/run.js';
import { sourceRequestContext } from '../../scraping/source-row.js';
import {
  asResponse,
  CLIST_ROBOTS_URL,
  clistTransport,
  openClistHarness,
  pageUrl,
  TEST_CREDENTIAL,
  type ClistHarness,
} from '../../testing/clist.js';

/** CLIST end to end on the fake transport, offline and with no real key (WP-11). */

let h: ClistHarness;

beforeEach(() => {
  h = openClistHarness();
});

afterEach(() => {
  h.close();
});

const run = (deps: ReturnType<ClistHarness['deps']>) =>
  runScrape(deps, { source: h.source, adapter: h.adapter, trigger: 'MANUAL' });

function adapterCalls(transport: ReturnType<typeof clistTransport>): string[] {
  return transport.calls.map((call) => call.url).filter((url) => url !== CLIST_ROBOTS_URL);
}

describe('pagination and listing_complete (A8)', () => {
  it('walks both pages against meta.total_count and reports a complete listing', async () => {
    const transport = clistTransport(h.clock, {
      0: asResponse('listing-page1.json'),
      2: asResponse('listing-page2.json'),
    });
    const row = await run(h.deps(transport));
    expect(row).toMatchObject({
      outcome: 'SUCCESS',
      listingComplete: true,
      itemsSeen: 3,
      itemsNew: 3,
      requestsMade: 2,
    });
    expect(adapterCalls(transport)).toEqual([pageUrl(h.clock, 0), pageUrl(h.clock, 2)]);
    expect(h.records.list(h.source.id).map((record) => record.externalKey)).toEqual([
      'clist:900001',
      'clist:900002',
      'clist:900003',
    ]);
  });

  it('hitting the request cap is PARTIAL with listing_complete = false', async () => {
    h.database.db.raw
      .prepare("update sources set max_requests_per_run = 1 where key = 'clist'")
      .run();
    const source = h.sources.findByKey('clist')!;
    const transport = clistTransport(h.clock, {
      0: asResponse('listing-page1.json'),
      2: asResponse('listing-page2.json'),
    });
    const row = await runScrape(h.deps(transport), {
      source,
      adapter: h.adapter,
      trigger: 'MANUAL',
    });
    expect(row).toMatchObject({
      outcome: 'PARTIAL',
      listingComplete: false,
      requestsMade: 1,
      itemsSeen: 2,
    });
  });

  it('asks for now − 1 day … now + 90 days, ordered by start, 100 a page', () => {
    const url = new URL(pageUrl(h.clock, 0));
    expect(url.pathname).toBe('/api/v4/contest/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      start__gte: '2026-09-20T00:00:00',
      start__lte: '2026-12-20T00:00:00',
      order_by: 'start',
      limit: '100',
      offset: '0',
    });
  });
});

describe('failures', () => {
  it('401 is HTTP_4XX with a note that the key may be invalid', async () => {
    const transport = clistTransport(h.clock, { 0: asResponse('http-401.json') });
    const row = await run(h.deps(transport));
    expect(row).toMatchObject({ outcome: 'FAILED', errorKind: 'HTTP_4XX', requestsMade: 1 });
    expect(row.errorDetail).toMatch(/API key .* may be invalid/);
  });

  it('429 honours Retry-After and then succeeds', async () => {
    const transport = clistTransport(h.clock, {
      0: [asResponse('http-429-retry-after.json'), asResponse('listing-recurring.json')],
    });
    const row = await run(h.deps(transport));
    expect(row.outcome).toBe('SUCCESS');
    expect(h.sleep.waits).toContain(30_000);
    expect(adapterCalls(transport)).toHaveLength(2);
  });

  it('the effective delay is ≥ 6 s, so never more than 10 requests a minute', async () => {
    expect(effectiveDelayMs(h.source.minDelayMs, undefined)).toBe(6_000);
    const transport = clistTransport(h.clock, {
      0: asResponse('listing-page1.json'),
      2: asResponse('listing-page2.json'),
    });
    await run(h.deps(transport));
    const waits = h.sleep.waits.filter((ms) => ms > 0);
    expect(waits.length).toBeGreaterThan(0);
    for (const wait of waits) {
      expect(wait).toBeGreaterThanOrEqual(6_000);
    }
    expect(60_000 / 6_000).toBeLessThanOrEqual(10);
  });
});

describe('the key (U4)', () => {
  it('no key → BLOCKED_BY_POLICY with zero transport calls, no backoff and no failure count', async () => {
    const transport = clistTransport(h.clock, { 0: asResponse('listing-page1.json') });
    const row = await run(h.deps(transport, { credential: undefined }));
    expect(row).toMatchObject({
      outcome: 'BLOCKED_BY_POLICY',
      errorKind: 'BLOCKED',
      errorDetail: 'CLIST API key not set (U4)',
      requestsMade: 0,
    });
    expect(transport.calls).toHaveLength(0);
    const state = h.sources.state(h.source.id, h.clock.now().getTime());
    expect(state).toMatchObject({
      consecutiveFailures: 0,
      backoffUntil: null,
      lastErrorKind: 'BLOCKED',
      lastErrorMessage: 'CLIST API key not set (U4)',
      nextDueAt: h.clock.now().getTime() + 30 * 60_000,
    });
  });

  it('sends the credential header on API requests but never on robots.txt', async () => {
    const transport = clistTransport(h.clock, { 0: asResponse('listing-recurring.json') });
    await run(h.deps(transport));
    for (const call of transport.calls) {
      const header = call.headers.authorization;
      expect(header, call.url).toBe(
        call.url === CLIST_ROBOTS_URL ? undefined : TEST_CREDENTIAL.value,
      );
    }
  });

  it('never writes the key to the log stream or to a snapshot', async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: 'debug' },
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString('utf8'));
          done();
        },
      }),
    );
    const transport = clistTransport(h.clock, { 0: asResponse('http-401.json') });
    await run(h.deps(transport, { logger }));
    const transport2 = clistTransport(h.clock, { 0: asResponse('listing-recurring.json') });
    // The 401 put the source into backoff; clear it so the second run happens.
    h.database.db.raw.prepare('update source_state set backoff_until = null').run();
    await run(h.deps(transport2, { logger, credential: TEST_CREDENTIAL }));
    const secret = 'test-key-0123456789abcdef';
    expect(lines.join('\n')).not.toContain(secret);
    const month = path.join(h.snapshots.root, 'clist', '2026-09');
    const files = readdirSync(month);
    expect(files.length).toBe(5);
    for (const file of files) {
      expect(gunzipSync(readFileSync(path.join(month, file))).toString('utf8')).not.toContain(
        secret,
      );
    }
  });
});

describe('robots.txt: the reviewed exemption (R77)', () => {
  function client(withCredential = true) {
    const credential = withCredential ? TEST_CREDENTIAL : undefined;
    const transport = clistTransport(h.clock, { 0: asResponse('listing-recurring.json') });
    const http = h
      .deps(transport)
      .http.clientFor(sourceRequestContext(h.source, credential), new AbortController().signal);
    return { transport, http };
  }

  it('applies to an allowed API path when the credential is present', async () => {
    const { transport, http } = client();
    const response = await http.get(pageUrl(h.clock, 0));
    expect(response.status).toBe(200);
    expect(adapterCalls(transport)).toHaveLength(1);
  });

  it('does not apply without the credential: ROBOTS_DISALLOWED and no API request', async () => {
    const { transport, http } = client(false);
    const refused = await http.get(pageUrl(h.clock, 0)).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ScrapeRequestError);
    expect((refused as ScrapeRequestError).refusal).toBe('ROBOTS_DISALLOWED');
    expect(adapterCalls(transport)).toHaveLength(0);
  });

  it.each([
    'https://clist.by/standings/',
    'https://clist.by/calendar/',
    'https://clist.by/api/v4/account/',
  ])('%s is refused with no request, credential or not', async (url) => {
    const { transport, http } = client();
    const refused = await http.get(url).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ScrapeRequestError);
    expect(['PATH_NOT_ALLOWED', 'ROBOTS_DISALLOWED']).toContain(
      (refused as ScrapeRequestError).refusal,
    );
    expect(transport.calls).toHaveLength(0);
  });
});

describe('R77 — the seeded exemption after migration 0018', () => {
  it('names the architect as reviewer, with a parseable date, over unchanged paths', () => {
    const config = JSON.parse(h.source.configJson) as {
      robotsExemption: { paths: string[]; reviewedBy: string; reviewedAt: string };
    };
    expect(config.robotsExemption.reviewedBy).toContain('architect');
    expect(config.robotsExemption.reviewedAt).toBe('2026-09-22');
    expect(Number.isNaN(Date.parse(config.robotsExemption.reviewedAt))).toBe(false);
    expect(config.robotsExemption.paths).toEqual([
      'clist.by/api/v4/contest/',
      'clist.by/api/v4/resource/',
    ]);
    expect(h.source.complianceNotes).toContain('ruling R77');
  });
});

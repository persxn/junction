import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  fakeTransport,
  manualSleeper,
  movableClock,
  testScrapingHttp,
  type FakeTransport,
} from '../../testing/scraping.js';
import {
  MAX_RESPONSE_BYTES,
  memoryValidatorStore,
  ROBOTS_TTL_MS,
  ScrapeRequestError,
} from './index.js';
import type { PoliteHttpClient } from './polite-client.js';
import { parseRobots } from './robots.js';
import type { SourceRequestContext } from './types.js';

/**
 * The PoliteHttpClient, on a fake transport.
 *
 * Nothing here opens a socket. The `Fetcher` seam is the only way out, and every
 * test below hands it a table of canned answers — which is what makes the
 * zero-request proofs meaningful: "Devpost is never called" is checked by
 * counting the calls the transport recorded, not by hoping.
 */

const ROBOTS_ALLOW_ALL = 'User-agent: *\nDisallow:\n';

function source(overrides: Partial<SourceRequestContext> = {}): SourceRequestContext {
  return {
    key: 'testsource',
    name: 'Test Source',
    complianceStatus: 'APPROVED_WITH_LIMITS',
    isEnabled: true,
    allowedPaths: ['example.test/api/'],
    minDelayMs: 3_000,
    maxRequestsPerRun: 6,
    ...overrides,
  };
}

function clientOn(
  transport: FakeTransport,
  options: {
    source?: Partial<SourceRequestContext>;
    contactEmail?: string;
    setupComplete?: boolean;
    online?: boolean;
    maxWaitMs?: number;
  } = {},
): { client: PoliteHttpClient; sleep: ReturnType<typeof manualSleeper> } {
  const clock = movableClock('2026-09-21T10:00:00.000Z');
  const sleep = manualSleeper();
  const http = testScrapingHttp({
    transport,
    clock,
    sleep,
    ...(options.contactEmail === undefined ? {} : { contactEmail: options.contactEmail }),
    ...(options.setupComplete === undefined ? {} : { setupComplete: options.setupComplete }),
    ...(options.online === undefined ? {} : { online: options.online }),
    ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
  });
  return {
    client: http.clientFor(source(options.source), new AbortController().signal),
    sleep,
  };
}

const API = 'https://example.test/api/events';
const ROBOTS = 'https://example.test/robots.txt';

describe('the eight §19 failure modes, on a fake transport', () => {
  it('timeout → TIMEOUT after two retries', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { throws: 'TIMEOUT' },
    });
    const { client, sleep } = clientOn(transport);
    await expect(client.get(API)).rejects.toMatchObject({ kind: 'TIMEOUT' });
    // Three attempts in all: the first plus §7.2's two retries.
    expect(transport.countFor(API)).toBe(3);
    // The first wait spaces the page request from the robots.txt fetch before
    // it; then the two retries. The exponential step is 2 s and then 4 s, and a
    // retry never waits less than the host's effective delay, so the first of
    // them is the 3-second floor rather than 2 s.
    expect(sleep.waits.filter((wait) => wait > 0)).toEqual([3_000, 3_000, 4_000]);
  });

  it('429 with Retry-After is obeyed and then succeeds', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: [
        { status: 429, headers: { 'retry-after': '30' } },
        { status: 200, body: '{"ok":true}' },
      ],
    });
    const { client, sleep } = clientOn(transport);
    const response = await client.get(API);
    expect(response.status).toBe(200);
    expect(sleep.waits).toContain(30_000);
    expect(transport.countFor(API)).toBe(2);
  });

  it('429 whose Retry-After exceeds the run budget is RATE_LIMITED, not waited out', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { status: 429, headers: { 'retry-after': '3600' } },
    });
    const { client, sleep } = clientOn(transport, { maxWaitMs: 60_000 });
    await expect(client.get(API)).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
      retryAfterMs: 3_600_000,
    });
    expect(transport.countFor(API)).toBe(1);
    expect(sleep.waits).not.toContain(3_600_000);
  });

  it('5xx is retried twice and then reported as HTTP_5XX', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { status: 502 },
    });
    const { client } = clientOn(transport);
    await expect(client.get(API)).rejects.toMatchObject({ kind: 'HTTP_5XX', status: 502 });
    expect(transport.countFor(API)).toBe(3);
  });

  it('robots disallow → the transport is never asked for the page at all', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: 'User-agent: *\nDisallow: /api/\n' },
      [API]: { status: 200, body: 'never reached' },
    });
    const { client } = clientOn(transport);
    await expect(client.get(API)).rejects.toMatchObject({ kind: 'ROBOTS_DISALLOWED' });
    expect(transport.countFor(API)).toBe(0);
    expect(transport.countFor(ROBOTS)).toBe(1);
  });

  it('TLS failure is reported once and never worked around', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { throws: 'TLS' },
    });
    const { client } = clientOn(transport);
    await expect(client.get(API)).rejects.toMatchObject({ kind: 'TLS' });
    expect(transport.countFor(API)).toBe(1);
  });

  it('403 is BLOCKED, tried once, with the same User-Agent (R60)', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { status: 403 },
    });
    const { client } = clientOn(transport);
    await expect(client.get(API)).rejects.toMatchObject({ kind: 'BLOCKED', status: 403 });
    expect(transport.countFor(API)).toBe(1);
    const agents = new Set(transport.calls.map((call) => call.headers['user-agent']));
    expect(agents.size).toBe(1);
  });

  it('answers offline without touching the transport (D-23)', () => {
    const transport = fakeTransport({});
    const { client } = clientOn(transport, { online: false });
    expect(client.isOnline()).toBe(false);
    expect(transport.calls).toHaveLength(0);
  });
});

describe('zero-request proofs (R60)', () => {
  it.each([
    ['a MANUAL_IMPORT_ONLY source', { complianceStatus: 'MANUAL_IMPORT_ONLY' as const }],
    ['a PENDING_REVIEW source', { complianceStatus: 'PENDING_REVIEW' as const }],
    ['a BLOCKED source', { complianceStatus: 'BLOCKED' as const }],
    ['a disabled source', { isEnabled: false }],
  ])('%s makes no request at all', async (_label, overrides) => {
    const transport = fakeTransport({ [ROBOTS]: { body: ROBOTS_ALLOW_ALL }, [API]: {} });
    const { client } = clientOn(transport, { source: overrides });
    await expect(client.get(API)).rejects.toBeInstanceOf(ScrapeRequestError);
    expect(transport.calls).toHaveLength(0);
  });

  it('a URL outside allowed_paths_json makes no request, not even for robots', async () => {
    const transport = fakeTransport({ [ROBOTS]: { body: ROBOTS_ALLOW_ALL } });
    const { client } = clientOn(transport);
    await expect(client.get('https://example.test/private/')).rejects.toMatchObject({
      refusal: 'PATH_NOT_ALLOWED',
    });
    expect(transport.calls).toHaveLength(0);
  });

  it('makes no request while setup is unfinished (A10/R44)', async () => {
    const transport = fakeTransport({ [ROBOTS]: { body: ROBOTS_ALLOW_ALL }, [API]: {} });
    const { client } = clientOn(transport, { setupComplete: false });
    await expect(client.get(API)).rejects.toMatchObject({ refusal: 'SETUP_INCOMPLETE' });
    expect(transport.calls).toHaveLength(0);
  });

  it('makes no request while scraper.contactEmail is unset (A10/R44)', async () => {
    const transport = fakeTransport({ [ROBOTS]: { body: ROBOTS_ALLOW_ALL }, [API]: {} });
    const { client } = clientOn(transport, { contactEmail: '   ' });
    await expect(client.get(API)).rejects.toMatchObject({ refusal: 'SETUP_INCOMPLETE' });
    expect(transport.calls).toHaveLength(0);
  });
});

describe('the User-Agent (§7.2)', () => {
  it('names the product, the version and the contact address', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { body: '{}' },
    });
    const { client } = clientOn(transport, { contactEmail: 'tech@example.edu' });
    await client.get(API);
    expect(transport.calls[0]?.headers['user-agent']).toBe(
      'Junction/1.2.3 (+mailto:tech@example.edu)',
    );
  });
});

describe('robots.txt caching (§7.2)', () => {
  const OTHER = 'https://other.test/api/events';

  it('fetches robots once per host, not once per request', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { body: '{}' },
      [`${API}/2`]: { body: '{}' },
    });
    const { client } = clientOn(transport);
    await client.get(API);
    await client.get(`${API}/2`);
    expect(transport.countFor(ROBOTS)).toBe(1);
  });

  it('treats two sub-domains as two hosts', async () => {
    const transport = fakeTransport({
      'https://a.devfolio.test/robots.txt': { body: ROBOTS_ALLOW_ALL },
      'https://b.devfolio.test/robots.txt': { body: ROBOTS_ALLOW_ALL },
      'https://a.devfolio.test/x': { body: '{}' },
      'https://b.devfolio.test/x': { body: '{}' },
    });
    const { client } = clientOn(transport, { source: { allowedPaths: ['*.devfolio.test'] } });
    await client.get('https://a.devfolio.test/x');
    await client.get('https://b.devfolio.test/x');
    expect(transport.countFor('https://a.devfolio.test/robots.txt')).toBe(1);
    expect(transport.countFor('https://b.devfolio.test/robots.txt')).toBe(1);
  });

  it('refetches once the 24-hour window has passed', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { body: '{}' },
    });
    const clock = movableClock('2026-09-21T10:00:00.000Z');
    const http = testScrapingHttp({ transport, clock });
    const first = http.clientFor(source(), new AbortController().signal);
    await first.get(API);
    expect(transport.countFor(ROBOTS)).toBe(1);

    // Hour 23: still cached.
    clock.advance(23 * 3_600_000);
    await http.clientFor(source(), new AbortController().signal).get(API);
    expect(transport.countFor(ROBOTS)).toBe(1);

    // Hour 25: refetched.
    clock.advance(2 * 3_600_000 + 1);
    expect(ROBOTS_TTL_MS).toBe(24 * 3_600_000);
    await http.clientFor(source(), new AbortController().signal).get(API);
    expect(transport.countFor(ROBOTS)).toBe(2);
  });

  it('treats a robots fetch that failed as "this host is off limits this run"', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { throws: 'TIMEOUT' },
      [API]: { body: '{}' },
    });
    const { client } = clientOn(transport);
    await expect(client.get(API)).rejects.toMatchObject({ kind: 'ROBOTS_DISALLOWED' });
    expect(transport.countFor(API)).toBe(0);
    // A second request does not even retry robots: the host is already ruled out.
    await expect(client.get(API)).rejects.toMatchObject({ kind: 'ROBOTS_DISALLOWED' });
    expect(transport.countFor(ROBOTS)).toBe(1);
  });

  it.each([404, 410, 500, 503])('treats robots %s as "no rules published"', async (status) => {
    const transport = fakeTransport({
      [ROBOTS]: { status },
      [API]: { body: '{}' },
    });
    const { client } = clientOn(transport);
    await expect(client.get(API)).resolves.toMatchObject({ status: 200 });
  });

  it('does not let one host’s rules govern another', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: 'User-agent: *\nDisallow: /api/\n' },
      'https://other.test/robots.txt': { body: ROBOTS_ALLOW_ALL },
      [OTHER]: { body: '{}' },
    });
    const { client } = clientOn(transport, {
      source: { allowedPaths: ['example.test/api/', 'other.test/api/'] },
    });
    await expect(client.get(API)).rejects.toMatchObject({ kind: 'ROBOTS_DISALLOWED' });
    await expect(client.get(OTHER)).resolves.toMatchObject({ status: 200 });
  });
});

describe("CTFtime's real robots.txt", () => {
  it('yields Crawl-delay 10 and allows /api/, parsed from the committed fixture', () => {
    // The number is read out of docs/research/robots/ctftime.org.txt rather than
    // written here, so a change to what CTFtime actually publishes shows up as a
    // failing test rather than as a stale constant.
    const fixture = readFileSync(
      path.resolve(import.meta.dirname, '../../../../../docs/research/robots/ctftime.org.txt'),
      'utf8',
    );
    const parsed = parseRobots('https://ctftime.org/robots.txt', fixture, 0);
    expect(parsed.crawlDelaySeconds).toBe(10);
    expect(parsed.isAllowed('https://ctftime.org/api/v1/events/')).toBe(true);
    expect(parsed.isAllowed('https://ctftime.org/api/v1/events/1234/')).toBe(true);
    // The five paths the file does disallow.
    expect(parsed.isAllowed('https://ctftime.org/user/1')).toBe(false);
    expect(parsed.isAllowed('https://ctftime.org/export/')).toBe(false);
  });
});

describe('the per-host politeness queue (§7.2)', () => {
  let transport: FakeTransport;

  beforeEach(() => {
    transport = fakeTransport({
      [ROBOTS]: { body: 'User-agent: *\nCrawl-delay: 10\n' },
      [API]: { body: '{}' },
      [`${API}/2`]: { body: '{}' },
    });
  });

  it('waits the effective delay between requests to the same host', async () => {
    const clock = movableClock('2026-09-21T10:00:00.000Z');
    const sleep = manualSleeper();
    const http = testScrapingHttp({ transport, clock, sleep });
    const client = http.clientFor(source({ minDelayMs: 3_000 }), new AbortController().signal);
    await client.get(API);
    await client.get(`${API}/2`);
    // Robots said 10 s and the source said 3 s, so the second request waits 10 s.
    expect(Math.max(...sleep.waits)).toBe(10_000);
  });

  it('keeps one request in flight per host', async () => {
    let inFlight = 0;
    let peak = 0;
    const clock = movableClock('2026-09-21T10:00:00.000Z');
    const http = testScrapingHttp({
      transport: {
        ...transport,
        fetcher: async (request) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          try {
            return await transport.fetcher(request);
          } finally {
            inFlight -= 1;
          }
        },
      },
      clock,
    });
    const client = http.clientFor(source(), new AbortController().signal);
    await Promise.all([client.get(API), client.get(`${API}/2`)]);
    expect(peak).toBe(1);
  });
});

describe('the request cap (§7.2)', () => {
  it('stops the run cleanly once max_requests_per_run is spent', async () => {
    const routes: Record<string, { body: string }> = { [ROBOTS]: { body: ROBOTS_ALLOW_ALL } };
    for (let index = 0; index < 5; index += 1) {
      routes[`${API}/${index.toString()}`] = { body: '{}' };
    }
    const transport = fakeTransport(routes);
    const { client } = clientOn(transport, { source: { maxRequestsPerRun: 2 } });
    await client.get(`${API}/0`);
    await client.get(`${API}/1`);
    await expect(client.get(`${API}/2`)).rejects.toMatchObject({
      refusal: 'REQUEST_CAP_REACHED',
    });
    expect(client.requestsMade).toBe(2);
    expect(client.requestsRemaining).toBe(0);
  });

  it('does not count robots.txt against the cap', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { body: '{}' },
    });
    const { client } = clientOn(transport, { source: { maxRequestsPerRun: 1 } });
    await client.get(API);
    expect(client.requestsMade).toBe(1);
    expect(transport.countFor(ROBOTS)).toBe(1);
  });
});

describe('conditional GET (§7.2, R58)', () => {
  it('sends the stored validators and reports a 304 as not-modified', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: [{ status: 200, body: '{"a":1}', headers: { etag: '"v1"' } }, { status: 304 }],
    });
    const clock = movableClock('2026-09-21T10:00:00.000Z');
    // An in-memory validator store; the database-backed one has its own test
    // next to the schema.
    const cache = memoryValidatorStore();
    const http = testScrapingHttp({ transport, clock, cache });
    const client = http.clientFor(source(), new AbortController().signal);

    const first = await client.get(API, { conditional: true });
    expect(first.status).toBe(200);
    expect(first.notModified).toBe(false);
    expect(cache.get(API)?.etag).toBe('"v1"');

    const second = await client.get(API, { conditional: true });
    expect(transport.calls.at(-1)?.headers['if-none-match']).toBe('"v1"');
    expect(second.notModified).toBe(true);
    expect(second.body).toHaveLength(0);
    expect(second.contentHash).toBe('');
  });

  it('sends no validators when the caller did not ask for a conditional GET', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { status: 200, body: '{}', headers: { etag: '"v1"' } },
    });
    const clock = movableClock('2026-09-21T10:00:00.000Z');
    const cache = memoryValidatorStore();
    const http = testScrapingHttp({ transport, clock, cache });
    const client = http.clientFor(source(), new AbortController().signal);
    await client.get(API, { conditional: true });
    await client.get(API);
    expect(transport.calls.at(-1)?.headers['if-none-match']).toBeUndefined();
  });
});

describe('the response size cap (§4.8)', () => {
  it('stops reading at 5 MB instead of buffering the whole body', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { body: Array.from({ length: 10 }, () => chunk) },
    });
    const { client } = clientOn(transport);
    await expect(client.get(API)).rejects.toMatchObject({ kind: 'UNKNOWN' });
    // Six chunks pulled: five fit under the cap, the sixth crossed it and the
    // reader stopped. Four were never asked for — and the request was not
    // retried, because an oversized body is not a transient failure.
    expect(transport.chunksRead.get(API)).toBe(MAX_RESPONSE_BYTES / chunk.byteLength + 1);
    expect(transport.countFor(API)).toBe(1);
  });
});

describe('the reachability probe (R61)', () => {
  it('probes once and then answers from the cache for five minutes', async () => {
    const transport = fakeTransport({
      [ROBOTS]: { body: ROBOTS_ALLOW_ALL },
      [API]: { status: 200 },
    });
    const clock = movableClock('2026-09-21T10:00:00.000Z');
    const http = testScrapingHttp({ transport, clock });
    const client = http.clientFor(source(), new AbortController().signal);
    expect(await client.isReachable(API)).toBe(true);
    expect(await client.isReachable(API)).toBe(true);
    expect(transport.countFor(API)).toBe(1);

    clock.advance(5 * 60_000 + 1);
    expect(await client.isReachable(API)).toBe(true);
    expect(transport.countFor(API)).toBe(2);
  });

  it('answers false offline, without sending anything', async () => {
    const transport = fakeTransport({});
    const { client } = clientOn(transport, { online: false });
    expect(await client.isReachable(API)).toBe(false);
    expect(transport.calls).toHaveLength(0);
  });
});

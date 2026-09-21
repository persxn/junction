import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasContactDetails } from '../../domain/normalize/index.js';
import { AppError } from '../../platform/errors.js';
import { runScrape } from '../../scraping/run.js';
import { sourceRequestContext } from '../../scraping/source-row.js';
import { expectGolden } from '../../testing/golden.js';
import { silentLogger, type FakeTransport } from '../../testing/scraping.js';
import {
  detailUrl,
  fakeTransport,
  json,
  openUnstopHarness,
  page,
  ROBOTS,
  unstopFixture,
  unstopRoutes,
  type UnstopHarness,
} from '../../testing/unstop.js';
import type { AdapterContext } from '../../sources/types.js';
import { fetchUnstop, isForbidden } from './fetch.js';

/** Unstop end to end on the fake transport (WP-13). All fixtures synthetic; no live network. */

let h: UnstopHarness;

beforeEach(() => {
  h = openUnstopHarness();
});

afterEach(() => {
  h.close();
});

const run = (transport: FakeTransport, options: { setupComplete?: boolean } = {}) =>
  runScrape(h.deps(transport, options), {
    source: h.source(),
    adapter: h.adapter,
    trigger: 'MANUAL',
  });

const urls = (transport: FakeTransport): string[] => transport.calls.map((call) => call.url);

describe('a run', () => {
  it('walks hackathons (two pages) and competitions, fetches each changed detail, listing complete', async () => {
    const transport = fakeTransport(unstopRoutes());
    const row = await run(transport);
    expect(row).toMatchObject({
      outcome: 'SUCCESS',
      listingComplete: true,
      itemsSeen: 6,
      itemsNew: 6,
    });
    expect(row.requestsMade).toBe(9);
    expect(urls(transport).filter((url) => url.includes('/api/public/opportunity/'))).toEqual([
      page('hackathons', 1),
      page('hackathons', 2),
      page('competitions', 1),
    ]);
  });

  it('non-MVP types are stored POLICY_HIDDEN with a reason, never dropped (D-31)', async () => {
    await run(fakeTransport(unstopRoutes()));
    const events = h.events.events.allEvents();
    expect(events).toHaveLength(6);
    const hidden = events.filter((event) => event.visibility === 'POLICY_HIDDEN');
    expect(hidden.map((event) => event.title).sort()).toEqual([
      'Brand Quiz Championship 2026',
      'Strategy Case Challenge 2026',
    ]);
    expect(hidden.every((event) => event.policyReason === 'EVENT_TYPE_OUT_OF_SCOPE')).toBe(true);
    expect(events.find((event) => event.title.startsWith('AlgoRush'))?.eventType).toBe(
      'CODING_CONTEST',
    );
  });

  it('goldens: every candidate the run stored', async () => {
    await run(fakeTransport(unstopRoutes()));
    expectGolden(
      'unstop/run.candidates',
      h.records.list(h.source().id).map((record) => JSON.parse(record.payloadJson) as unknown),
    );
  });
});

describe('only /api/public/* is ever requested from /api/', () => {
  it('no /api/* path other than /api/public/* is requested in a whole run', async () => {
    const transport = fakeTransport(unstopRoutes());
    await run(transport);
    const api = urls(transport).filter((url) => new URL(url).pathname.startsWith('/api/'));
    expect(api.length).toBeGreaterThan(0);
    expect(api.every((url) => new URL(url).pathname.startsWith('/api/public/'))).toBe(true);
  });

  it.each([
    'https://unstop.com/u/someone',
    'https://unstop.com/p/someone-123',
    'https://unstop.com/pf/someone',
    'https://unstop.com/directory/user/123',
    'https://unstop.com/certificate-preview/abc',
    'https://unstop.com/mentor/book-mentor/42',
    'https://unstop.com/api/get-attachment/9',
    'https://unstop.com/competitions/codestorm-1100001/register',
    'https://unstop.com/api/private-ish/opportunities',
    'https://unstop.com/api/user/me',
    'https://evil.example/api/public/x',
  ])('%s is refused before any transport call', async (url) => {
    expect(isForbidden(url)).toBe(true);
    const transport = fakeTransport({});
    const context: AdapterContext = {
      http: h
        .deps(transport)
        .http.clientFor(sourceRequestContext(h.source()), new AbortController().signal),
      log: silentLogger,
      clock: h.clock,
      now: () => h.clock.now(),
      signal: new AbortController().signal,
      config: {},
    };
    const refused = await fetchUnstop(context, url).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AppError);
    expect((refused as AppError).code).toBe('SOURCE_PATH_FORBIDDEN');
    expect(transport.calls).toHaveLength(0);
  });

  it('a payload URL pointing at /u/ or a private /api/ path is never followed', async () => {
    const listing = JSON.parse(unstopFixture('listing-hackathons-p1.json')) as {
      data: { data: { public_url: string }[] };
    };
    listing.data.data[0]!.public_url = 'u/someone';
    listing.data.data[1]!.public_url = 'api/private-ish/x';
    const transport = fakeTransport(
      unstopRoutes({ [page('hackathons', 1)]: { body: JSON.stringify(listing) } }),
    );
    await run(transport);
    for (const url of urls(transport)) {
      expect(isForbidden(url), url).toBe(false);
    }
  });
});

describe('the gate', () => {
  it('MANUAL_IMPORT_ONLY → zero requests', async () => {
    h.database.db.raw
      .prepare("update sources set compliance_status = 'MANUAL_IMPORT_ONLY' where key = 'unstop'")
      .run();
    const transport = fakeTransport(unstopRoutes());
    const row = await run(transport);
    expect(row.outcome).toBe('BLOCKED_BY_POLICY');
    expect(transport.calls).toHaveLength(0);
  });

  it('no scraper.contactEmail (setup incomplete) → nothing runs at all (A10)', async () => {
    const transport = fakeTransport(unstopRoutes());
    const row = await run(transport, { setupComplete: false });
    expect(row.outcome).toBe('BLOCKED_BY_POLICY');
    expect(transport.calls).toHaveLength(0);
  });
});

describe('PII (D-29)', () => {
  it('no e-mail or phone survives, and no people-shaped field reaches a candidate', async () => {
    await run(fakeTransport(unstopRoutes()));
    for (const record of h.records.list(h.source().id)) {
      const text = record.payloadJson;
      // Prose only: URLs are not redacted, and Unstop's end in "-2026-1100001",
      // which the phone heuristic would read as a number.
      const prose: string[] = [];
      const walk = (value: unknown): void => {
        if (typeof value === 'string') {
          if (!/^https?:\/\//.test(value)) {
            prose.push(value);
          }
        } else if (Array.isArray(value)) {
          value.forEach(walk);
        } else if (value !== null && typeof value === 'object') {
          Object.values(value).forEach(walk);
        }
      };
      walk(JSON.parse(text));
      expect(hasContactDetails(prose.join('\n'))).toBe(false);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      for (const name of ['Invented Organiser', 'Synthetic Student', 'Madeup Judge']) {
        expect(text).not.toContain(name);
      }
      const keys = [...text.matchAll(/"([^"]+)":/g)].map((match) => match[1]!);
      expect(
        keys.filter((key) =>
          /participant|registered|judge|mentor|contact|email|phone|mobile/i.test(key),
        ),
      ).toEqual([]);
    }
  });
});

describe('schema drift and the HTML fallback (R71, step 6)', () => {
  it('a renamed field with an unusable SPA fallback → FAILED SCHEMA_CHANGED, nothing written, no empty events', async () => {
    const shell = {
      body: unstopFixture('spa-shell.html'),
      headers: { 'content-type': 'text/html' },
    };
    const transport = fakeTransport(
      unstopRoutes({
        [page('hackathons', 1)]: json('listing-renamed.json'),
        'https://unstop.com/hackathons/': shell,
        'https://unstop.com/competitions/': shell,
      }),
    );
    const row = await run(transport);
    expect(row).toMatchObject({ outcome: 'FAILED', errorKind: 'SCHEMA_CHANGED', itemsSeen: 0 });
    expect(h.records.list(h.source().id)).toHaveLength(0);
    expect(h.events.events.allEvents()).toHaveLength(0);
  });

  it("a 404 on the JSON listing falls back to the pages' embedded state; the run is PARTIAL", async () => {
    // No detail fetches, so the listing candidates (and their warning) are what is stored.
    h.database.db.raw
      .prepare(
        `update sources set config_json = json_set(config_json, '$.maxDetailsPerRun', 0) where key = 'unstop'`,
      )
      .run();
    const withState = {
      body: unstopFixture('ng-state.html'),
      headers: { 'content-type': 'text/html' },
    };
    const transport = fakeTransport(
      unstopRoutes({
        [page('hackathons', 1)]: { status: 404, body: 'not found' },
        'https://unstop.com/hackathons/': withState,
        'https://unstop.com/competitions/': { body: unstopFixture('spa-shell.html') },
      }),
    );
    const row = await run(transport);
    expect(row).toMatchObject({ outcome: 'PARTIAL', listingComplete: false, itemsSeen: 2 });
    const candidate = JSON.parse(h.records.list(h.source().id)[0]!.payloadJson) as {
      warnings: { code: string }[];
    };
    expect(candidate.warnings.map((warning) => warning.code)).toContain('DETAIL_UNAVAILABLE');
  });
});

describe('politeness and caps', () => {
  it('consecutive requests are ≥ 3 s apart on the injected clock', async () => {
    await run(fakeTransport(unstopRoutes()));
    const waits = h.sleep.waits.filter((ms) => ms > 0);
    expect(waits.length).toBeGreaterThan(0);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(3_000);
  });

  it('a 429 with Retry-After is honoured', async () => {
    const transport = fakeTransport(
      unstopRoutes({
        [page('hackathons', 1)]: [
          { status: 429, headers: { 'retry-after': '20' } },
          json('listing-hackathons-p1.json'),
        ],
      }),
    );
    const row = await run(transport);
    expect(row.outcome).toBe('SUCCESS');
    expect(h.sleep.waits).toContain(20_000);
  });

  it('a 403 is BLOCKED and not retried with another User-Agent (D-28)', async () => {
    const transport = fakeTransport(
      unstopRoutes({ [page('hackathons', 1)]: json('http-403.json') }),
    );
    const row = await run(transport);
    expect(row).toMatchObject({ outcome: 'FAILED', errorKind: 'BLOCKED' });
    const attempts = transport.calls.filter((call) => call.url === page('hackathons', 1));
    expect(attempts).toHaveLength(1);
    expect(new Set(transport.calls.map((call) => call.headers['user-agent'])).size).toBe(1);
  });

  it('a listing longer than the cap stops there: PARTIAL, listing_complete false (A8)', async () => {
    h.database.db.raw
      .prepare("update sources set max_requests_per_run = 2 where key = 'unstop'")
      .run();
    const row = await run(fakeTransport(unstopRoutes()));
    expect(row).toMatchObject({ outcome: 'PARTIAL', listingComplete: false, requestsMade: 2 });
  });

  it('robots.txt is the recorded one and is fetched once per run', async () => {
    const transport = fakeTransport(unstopRoutes());
    await run(transport);
    expect(urls(transport).filter((url) => url === ROBOTS)).toHaveLength(1);
    expect(urls(transport)).toContain(detailUrl(1100001));
  });
});

describe('R73: compliance reviews expire', () => {
  it('Unstop is due for review on 21 Mar 2027; after that date it is reported overdue', () => {
    const due = h.source().complianceReviewDueAt;
    expect(due).toBe(Date.parse('2027-03-21T00:00:00Z'));
    expect(h.sources.overdueReviews(Date.parse('2026-09-21T00:00:00Z'))).toEqual([]);
    expect(
      h.sources.overdueReviews(Date.parse('2027-03-22T00:00:00Z')).map((source) => source.key),
    ).toEqual(['unstop']);
  });
});

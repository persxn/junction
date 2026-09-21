import { readdirSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasContactDetails } from '../../domain/normalize/index.js';
import { AppError } from '../../platform/errors.js';
import { runScrape } from '../../scraping/run.js';
import { sourceRequestContext } from '../../scraping/source-row.js';
import {
  DISALLOW_ALL,
  detailFromListing,
  devfolioHtml,
  devfolioRoutes,
  fakeTransport,
  html,
  LISTING_URL,
  nextPage,
  openDevfolioHarness,
  openHackathons,
  pagePropsOf,
  robotsUrl,
  type DevfolioHarness,
} from '../../testing/devfolio.js';
import { silentLogger, type FakeTransport } from '../../testing/scraping.js';
import type { AdapterContext } from '../../sources/types.js';
import { fetchPage } from './fetch.js';

/** Devfolio end to end on the fake transport (WP-12). No request leaves the process. */

let h: DevfolioHarness;

beforeEach(() => {
  h = openDevfolioHarness();
});

afterEach(() => {
  h.close();
});

const run = (transport: FakeTransport, http = h.http(transport)) =>
  runScrape(h.deps(transport, http), {
    source: h.sources.findByKey('devfolio')!,
    adapter: h.adapter,
    trigger: 'MANUAL',
  });

/** The recorded listing with a detail page per open hackathon (the recorded one for recursiveacm). */
function recordedRoutes(): ReturnType<typeof devfolioRoutes> {
  const details: Record<string, string> = {};
  for (const hackathon of openHackathons()) {
    const slug = String(hackathon.slug);
    details[slug] =
      slug === 'recursiveacm'
        ? devfolioHtml('detail-recursiveacm.html')
        : detailFromListing(hackathon);
  }
  return devfolioRoutes(devfolioHtml('listing.html'), details);
}

const hosts = (transport: FakeTransport): string[] =>
  transport.calls.map((call) => new URL(call.url).hostname);

describe('a run', () => {
  it('walks open + upcoming, fetches each changed detail, and reports a complete listing', async () => {
    const transport = fakeTransport(recordedRoutes());
    const row = await run(transport);
    expect(row.errorDetail).toBeNull();
    expect(row).toMatchObject({
      outcome: 'SUCCESS',
      listingComplete: true,
      itemsSeen: 5,
      itemsNew: 5,
      requestsMade: 6,
    });
    const recursive = h.records
      .list(h.source.id)
      .find((record) => record.url === 'https://recursiveacm.devfolio.co/');
    expect(recursive?.externalKey).toBe('devfolio:72aac6f9ba9f4fc6b24fe9bfe979acaf');
    expect(h.events.events.allEvents()).toHaveLength(5);
  });

  it('the detail cap leaves the rest queued and the run PARTIAL, with the listing still complete', async () => {
    h.database.db.raw
      .prepare(
        `update sources set config_json = json_set(config_json, '$.maxDetailsPerRun', 2) where key = 'devfolio'`,
      )
      .run();
    const transport = fakeTransport(recordedRoutes());
    const row = await run(transport);
    expect(row).toMatchObject({
      outcome: 'PARTIAL',
      listingComplete: true,
      itemsSeen: 5,
      requestsMade: 3,
    });
    const pending = h.records
      .list(h.source.id)
      .filter((record) => record.lastFetchedAt < record.lastSeenAt);
    expect(pending).toHaveLength(3);
  });
});

describe('api.devfolio.co is never contacted', () => {
  it('a whole run makes no request to that host, even when a payload links to it', async () => {
    const hackathons = openHackathons();
    (hackathons[0]!.settings as Record<string, unknown>).site =
      'https://api.devfolio.co/api/hackathons/recursiveacm';
    const listing = nextPage({
      ...pagePropsOf(devfolioHtml('listing.html')),
      open_hackathons: hackathons,
    });
    const details = Object.fromEntries(
      hackathons.map((one) => [String(one.slug), detailFromListing(one)]),
    );
    const transport = fakeTransport(devfolioRoutes(listing, details));
    await run(transport);
    expect(hosts(transport)).not.toContain('api.devfolio.co');
    expect(transport.calls.length).toBeGreaterThan(0);
  });

  it('the fetch helper throws SOURCE_HOST_FORBIDDEN with zero transport calls', async () => {
    const transport = fakeTransport({});
    const context: AdapterContext = {
      http: h
        .http(transport)
        .clientFor(sourceRequestContext(h.source), new AbortController().signal),
      log: silentLogger,
      clock: h.clock,
      now: () => h.clock.now(),
      signal: new AbortController().signal,
      config: {},
    };
    for (const url of [
      'https://api.devfolio.co/api/hackathons',
      'https://API.devfolio.co/',
      'https://x.api.devfolio.co/',
    ]) {
      const refused = await fetchPage(context, url).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(AppError);
      expect((refused as AppError).code).toBe('SOURCE_HOST_FORBIDDEN');
    }
    expect(transport.calls).toHaveLength(0);
  });
});

describe('per-subdomain robots (each <slug>.devfolio.co is its own host)', () => {
  function twoSlugs(nameSuffix = ''): {
    listing: string;
    details: Record<string, string>;
    slugs: string[];
  } {
    const hackathons: Record<string, unknown>[] = openHackathons()
      .slice(0, 2)
      .map((one) => ({ ...one, name: `${String(one.name)}${nameSuffix}` }));
    const listing = nextPage({
      open_hackathons: hackathons,
      upcoming_hackathons: [],
      past_hackathons: [],
      featured_hackathons: [],
    });
    const details = Object.fromEntries(
      hackathons.map((one) => [String(one.slug), detailFromListing(one)]),
    );
    return { listing, details, slugs: hackathons.map((one) => String(one.slug)) };
  }

  it('two slugs → two subdomain robots fetches on the first run, zero on the second (24 h cache)', async () => {
    const first = twoSlugs();
    const routes = devfolioRoutes(first.listing, first.details);
    // The second run sees changed listing items, so both details are fetched again.
    const second = twoSlugs(' (updated)');
    const transport = fakeTransport({
      ...routes,
      [LISTING_URL]: [html(first.listing), html(second.listing)],
    });
    const http = h.http(transport);
    const subRobots = (): number =>
      transport.calls.filter((call) => call.url.endsWith('.devfolio.co/robots.txt')).length;

    await run(transport, http);
    expect(subRobots()).toBe(2);
    h.clock.advance(60 * 60_000);
    const before = subRobots();
    const row = await run(transport, http);
    expect(row.itemsUpdated).toBe(2);
    expect(subRobots() - before).toBe(0);
    expect(
      transport.calls.filter((call) =>
        first.slugs.some((slug) => call.url === `https://${slug}.devfolio.co/`),
      ),
    ).toHaveLength(4);
  });

  it('a subdomain whose robots disallows / is skipped with no page request; the listing candidate stays; PARTIAL', async () => {
    const { listing, details, slugs } = twoSlugs();
    const blocked = `${slugs[1]!}.devfolio.co`;
    const transport = fakeTransport(devfolioRoutes(listing, details, { [blocked]: DISALLOW_ALL }));
    const row = await run(transport);
    expect(row).toMatchObject({
      outcome: 'PARTIAL',
      listingComplete: true,
      itemsSeen: 2,
      itemsInvalid: 0,
    });
    expect(transport.calls.map((call) => call.url)).toContain(robotsUrl(blocked));
    expect(transport.calls.map((call) => call.url)).not.toContain(`https://${blocked}/`);
    const record = h.records.list(h.source.id).find((one) => one.url === `https://${blocked}/`)!;
    const candidate = JSON.parse(record.payloadJson) as { warnings: { code: string }[] };
    expect(candidate.warnings.map((warning) => warning.code)).toContain('DETAIL_UNAVAILABLE');
  });
});

describe('PII is dropped at the boundary (D-29)', () => {
  it('detail-pii.html through the real adapter leaves no e-mail, phone or people-shaped key', async () => {
    const pii = pagePropsOf(devfolioHtml('detail-pii.html'));
    const hackathon = pii.hackathon as Record<string, unknown>;
    const listing = nextPage({
      open_hackathons: [hackathon],
      upcoming_hackathons: [],
      past_hackathons: [],
      featured_hackathons: [],
    });
    const transport = fakeTransport(
      devfolioRoutes(listing, { [String(hackathon.slug)]: devfolioHtml('detail-pii.html') }),
    );
    const row = await run(transport);
    expect(row.outcome).toBe('SUCCESS');
    const [record] = h.records.list(h.source.id);
    const candidate = JSON.parse(record!.payloadJson) as unknown;

    const strings: string[] = [];
    const keys: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        strings.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (value !== null && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          keys.push(key);
          walk(inner);
        }
      }
    };
    walk(candidate);
    const text = strings.join('\n');
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(hasContactDetails(text)).toBe(false);
    expect(keys.filter((key) => /participant|judge|mentor|contact|email|phone/i.test(key))).toEqual(
      [],
    );
    for (const name of [
      'Fixtureson',
      'Samplekar',
      'Madeup Judge',
      'Invented Mentor',
      'synthetic_handle',
    ]) {
      expect(text).not.toContain(name);
    }
    expect(text).toContain('[contact details on the source page]');
  });
});

describe('format changes are loud; an empty week is not', () => {
  it('renamed buckets → FAILED, SCHEMA_CHANGED, zero events, backoff, snapshot kept', async () => {
    const transport = fakeTransport({
      [robotsUrl('devfolio.co')]: { body: 'User-agent: *\nDisallow:\n' },
      [LISTING_URL]: html(devfolioHtml('detail-schema-changed.html')),
    });
    const row = await run(transport);
    expect(row).toMatchObject({ outcome: 'FAILED', errorKind: 'SCHEMA_CHANGED', itemsSeen: 0 });
    expect(h.events.events.allEvents()).toHaveLength(0);
    expect(h.records.list(h.source.id)).toHaveLength(0);
    expect(h.sources.state(h.source.id, h.clock.now().getTime()).consecutiveFailures).toBe(1);
    const month = path.join(h.snapshots.root, 'devfolio', '2026-09');
    expect(readdirSync(month).filter((file) => file.startsWith('format-failure-'))).toHaveLength(1);
  });

  it('all buckets present and empty → SUCCESS with zero items and no error', async () => {
    const transport = fakeTransport({
      [robotsUrl('devfolio.co')]: { body: 'User-agent: *\nDisallow:\n' },
      [LISTING_URL]: html(devfolioHtml('listing-empty.html')),
    });
    const row = await run(transport);
    expect(row).toMatchObject({
      outcome: 'SUCCESS',
      listingComplete: true,
      itemsSeen: 0,
      errorKind: null,
    });
  });
});

describe('politeness', () => {
  it('the effective per-host delay is ≥ 3 s and only one request per host is ever in flight', async () => {
    const inner = fakeTransport(recordedRoutes());
    const inFlight = new Map<string, number>();
    let worst = 0;
    const spied = {
      fetcher: async (request: Parameters<FakeTransport['fetcher']>[0]) => {
        const host = new URL(request.url).hostname;
        inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
        worst = Math.max(worst, inFlight.get(host) ?? 0);
        await Promise.resolve();
        try {
          return await inner.fetcher(request);
        } finally {
          inFlight.set(host, (inFlight.get(host) ?? 1) - 1);
        }
      },
    };
    const http = h.http(spied);
    await runScrape(h.deps(inner, http), {
      source: h.source,
      adapter: h.adapter,
      trigger: 'MANUAL',
    });
    expect(worst).toBe(1);
    const waits = h.sleep.waits.filter((ms) => ms > 0);
    expect(waits.length).toBeGreaterThan(0);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(3_000);
  });
});

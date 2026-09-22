import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createDevfolioAdapter } from '../adapters/devfolio/adapter.js';
import { loadHtmlParser, nextData } from '../adapters/devfolio/extract.js';
import type { SourceRow } from '../db/schema/index.js';
import { createEventsModule, type EventsModule } from '../modules/events/wiring.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { AuditLog } from '../platform/audit.js';
import { SettingsStore } from '../platform/settings.js';
import { parseSessionKey } from '../modules/sources/seal.js';
import type { SessionVault } from '../modules/sources/session.js';
import { TEST_SESSION_KEY_HEX } from './session-key.js';
import type { Clock } from '../platform/time.js';
import type { Fetcher, ScrapingHttp } from '../scraping/http/index.js';
import type { ScrapeRunDependencies } from '../scraping/run.js';
import { SnapshotStore } from '../scraping/snapshots.js';
import type { SourceAdapter } from '../sources/types.js';
import { openTestGeo, type TestGeo } from './ctftime.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';
import { fixturesDir } from './golden.js';
import {
  fakeTransport,
  manualSleeper,
  movableClock,
  silentLogger,
  testScrapingHttp,
  type FakeResponse,
  type FakeTransport,
} from './scraping.js';

/**
 * A Devfolio run end to end on the fake transport (WP-12): the migrated
 * database with the seeded `devfolio` row (migration 0010), the real adapter,
 * orchestrator and linker. Robots are served per host, as Devfolio serves them:
 * the apex and every `<slug>.devfolio.co` answer separately.
 */

export const DEVFOLIO_START = '2026-09-21T00:00:00.000Z';
export const LISTING_URL = 'https://devfolio.co/hackathons';
export const ALLOW_ALL = 'User-agent: *\nDisallow:\n';
export const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

export function devfolioHtml(name: string): string {
  return readFileSync(path.join(fixturesDir(), 'devfolio', name), 'utf8');
}

export function researchJson(name: string): unknown {
  return JSON.parse(
    readFileSync(
      path.resolve(
        import.meta.dirname,
        '..',
        '..',
        '..',
        '..',
        'docs',
        'research',
        'fixtures',
        'devfolio',
        name,
      ),
      'utf8',
    ),
  ) as unknown;
}

// Test helpers parse fixtures synchronously; load the parser once up front.
await loadHtmlParser();

/** A `__NEXT_DATA__` page around any page props — for cases built inside a test. */
export function nextPage(pageProps: unknown): string {
  const json = JSON.stringify({ props: { pageProps }, page: '/', buildId: 'test' }).replace(
    /<\//g,
    '<\\/',
  );
  return `<!DOCTYPE html><html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`;
}

export function pagePropsOf(html: string): Record<string, unknown> {
  return (nextData(html) as { props: { pageProps: Record<string, unknown> } }).props.pageProps;
}

/** The recorded listing's open hackathons, as objects a test can edit. */
export function openHackathons(): Record<string, unknown>[] {
  return structuredClone(pagePropsOf(devfolioHtml('listing.html')).open_hackathons) as Record<
    string,
    unknown
  >[];
}

export function robotsUrl(host: string): string {
  return `https://${host}/robots.txt`;
}

export function html(body: string): FakeResponse {
  return { body, headers: { 'content-type': 'text/html; charset=utf-8' } };
}

/** Routes for a listing page and a detail page per hackathon, every host allowing all. */
export function devfolioRoutes(
  listing: string,
  details: Readonly<Record<string, string>>,
  robots: Readonly<Record<string, string>> = {},
): Record<string, FakeResponse> {
  const routes: Record<string, FakeResponse> = {
    [robotsUrl('devfolio.co')]: { body: robots['devfolio.co'] ?? ALLOW_ALL },
    [LISTING_URL]: html(listing),
  };
  for (const [slug, page] of Object.entries(details)) {
    const host = `${slug}.devfolio.co`;
    routes[robotsUrl(host)] = { body: robots[host] ?? ALLOW_ALL };
    routes[`https://${host}/`] = html(page);
  }
  return routes;
}

/** A listing hackathon as the detail page would carry it, when no recording exists. */
export function detailFromListing(hackathon: Record<string, unknown>): string {
  return nextPage({
    hackathon,
    aggregatePrizeValue: 0,
    aggregatePrizeCurrency: 'USD',
    prizeDetails: [],
  });
}

export interface DevfolioHarness {
  readonly database: MigratedDatabase;
  readonly source: SourceRow;
  /** WP-14: where a stored session lives, so a test can sign the app in. */
  readonly settings: SettingsStore;
  /** R76: that store plus the data key that opens what is sealed in it. */
  readonly vault: SessionVault;
  readonly adapter: SourceAdapter;
  readonly events: EventsModule;
  readonly records: SourceRecordsRepository;
  readonly sources: SourcesRepository;
  readonly snapshots: SnapshotStore;
  readonly clock: Clock & { advance(ms: number): void };
  readonly sleep: ReturnType<typeof manualSleeper>;
  /** One HTTP layer per transport, so the robots cache lives across runs as it does in production. */
  http(transport: FakeTransport | { fetcher: Fetcher }): ScrapingHttp;
  deps(
    transport: FakeTransport,
    http?: ScrapingHttp,
    extra?: Partial<ScrapeRunDependencies>,
  ): ScrapeRunDependencies;
  close(): void;
}

export function openDevfolioHarness(): DevfolioHarness {
  const database = openMigratedDatabase(silentLogger, 'devfolio');
  const clock = movableClock(DEVFOLIO_START);
  const geo: TestGeo = openTestGeo();
  const settings = new SettingsStore(database.db, { clock });
  // R76: a fixed key, so a sealed value is reproducible across a test run and a
  // test can prove the ciphertext is not the cookie.
  const vault: SessionVault = { settings, key: parseSessionKey(TEST_SESSION_KEY_HEX) };
  const audit = new AuditLog(database.db, { clock });
  const events = createEventsModule({
    db: database.db,
    geocoder: geo.geocoder,
    settings,
    audit,
    logger: silentLogger,
    clock,
  });
  const sources = new SourcesRepository(database.db);
  const source = sources.findByKey('devfolio');
  if (source === undefined) {
    throw new Error('migrations 0006/0010 did not seed the devfolio row');
  }
  const records = new SourceRecordsRepository(database.db);
  const snapshots = new SnapshotStore({ config: database.config, logger: silentLogger, clock });
  const sleep = manualSleeper();
  const http = (transport: FakeTransport | { fetcher: Fetcher }): ScrapingHttp =>
    testScrapingHttp({ transport: transport as FakeTransport, clock, sleep });
  return {
    database,
    source,
    settings,
    vault,
    adapter: createDevfolioAdapter({ geo: geo.geocoder }),
    events,
    records,
    sources,
    snapshots,
    clock,
    sleep,
    http,
    deps: (transport, shared, extra = {}) => ({
      sources,
      records,
      http: shared ?? http(transport),
      snapshots,
      clock,
      logger: silentLogger,
      setupComplete: () => true,
      linker: events.linker,
      ...extra,
    }),
    close: () => {
      geo.close();
      database.close();
    },
  };
}

export { fakeTransport };

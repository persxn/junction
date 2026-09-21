import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createUnstopAdapter, unstopListingUrl } from '../adapters/unstop/adapter.js';
import { loadHtmlParser } from '../adapters/shared/html.js';
import type { SourceRow } from '../db/schema/index.js';
import { createEventsModule, type EventsModule } from '../modules/events/wiring.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { AuditLog } from '../platform/audit.js';
import { SettingsStore } from '../platform/settings.js';
import type { Clock } from '../platform/time.js';
import type { ScrapingHttp } from '../scraping/http/index.js';
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
 * An Unstop run end to end on the fake transport (WP-13), with the recorded
 * `unstop.com/robots.txt` served as the site serves it. Every Unstop fixture is
 * synthetic (see its `_note` and `.meta.json`): the live capture is owed.
 */

await loadHtmlParser();

export const UNSTOP_START = '2026-09-21T00:00:00.000Z';
export const ROBOTS = 'https://unstop.com/robots.txt';
export const LISTING_CONFIG = {
  listingPath: '/api/public/opportunity/search-result',
  opportunities: ['hackathons', 'competitions'],
  perPage: 30,
  detailPath: '/api/public/competition/',
};

export function recordedUnstopRobots(): string {
  return readFileSync(
    path.resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'docs',
      'research',
      'robots',
      'unstop.com.txt',
    ),
    'utf8',
  );
}

export function unstopFixture(name: string): string {
  return readFileSync(path.join(fixturesDir(), 'unstop', name), 'utf8');
}

export function json(name: string): FakeResponse {
  const body = unstopFixture(name);
  const parsed = JSON.parse(body) as {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  };
  if (typeof parsed.status === 'number') {
    return { status: parsed.status, headers: parsed.headers ?? {}, body: parsed.body ?? '' };
  }
  return { body, headers: { 'content-type': 'application/json' } };
}

export function page(opportunity: string, number: number): string {
  return unstopListingUrl(LISTING_CONFIG, opportunity, number);
}

export function detailUrl(id: number): string {
  return `https://unstop.com/api/public/competition/${String(id)}`;
}

export const DETAIL_IDS = [1100001, 1100002, 1100003, 1200001, 1200002, 1200003];

/** The full synthetic listing (hackathons over two pages, competitions on one) plus every detail. */
export function unstopRoutes(
  overrides: Readonly<Record<string, FakeResponse | readonly FakeResponse[]>> = {},
): Record<string, FakeResponse | readonly FakeResponse[]> {
  const routes: Record<string, FakeResponse | readonly FakeResponse[]> = {
    [ROBOTS]: { body: recordedUnstopRobots() },
    [page('hackathons', 1)]: json('listing-hackathons-p1.json'),
    [page('hackathons', 2)]: json('listing-hackathons-p2.json'),
    [page('competitions', 1)]: json('listing-competitions-p1.json'),
  };
  for (const id of DETAIL_IDS) {
    routes[detailUrl(id)] = json(`detail-${String(id)}.json`);
  }
  return { ...routes, ...overrides };
}

export interface UnstopHarness {
  readonly database: MigratedDatabase;
  readonly source: () => SourceRow;
  readonly adapter: SourceAdapter;
  readonly events: EventsModule;
  readonly records: SourceRecordsRepository;
  readonly sources: SourcesRepository;
  readonly snapshots: SnapshotStore;
  readonly clock: Clock & { advance(ms: number): void };
  readonly sleep: ReturnType<typeof manualSleeper>;
  deps(
    transport: FakeTransport,
    options?: { setupComplete?: boolean; http?: ScrapingHttp },
  ): ScrapeRunDependencies;
  close(): void;
}

export function openUnstopHarness(): UnstopHarness {
  const database = openMigratedDatabase(silentLogger, 'unstop');
  const clock = movableClock(UNSTOP_START);
  const geo: TestGeo = openTestGeo();
  const settings = new SettingsStore(database.db, { clock });
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
  const records = new SourceRecordsRepository(database.db);
  const snapshots = new SnapshotStore({ config: database.config, logger: silentLogger, clock });
  const sleep = manualSleeper();
  return {
    database,
    source: () => sources.findByKey('unstop')!,
    adapter: createUnstopAdapter(),
    events,
    records,
    sources,
    snapshots,
    clock,
    sleep,
    deps: (transport, options = {}) => ({
      sources,
      records,
      http:
        options.http ??
        testScrapingHttp({
          transport,
          clock,
          sleep,
          ...(options.setupComplete === undefined ? {} : { setupComplete: options.setupComplete }),
        }),
      snapshots,
      clock,
      logger: silentLogger,
      setupComplete: () => options.setupComplete ?? true,
      linker: events.linker,
    }),
    close: () => {
      geo.close();
      database.close();
    },
  };
}

export { fakeTransport };

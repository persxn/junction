import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createCtftimeAdapter, LISTING_WINDOW_DAYS } from '../adapters/ctftime/adapter.js';
import { detailUrl, listingUrl } from '../adapters/ctftime/paths.js';
import type { SourceRow } from '../db/schema/index.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import type { Clock } from '../platform/time.js';
import type { ScrapeRunDependencies } from '../scraping/run.js';
import { SnapshotStore } from '../scraping/snapshots.js';
import type { SourceAdapter } from '../sources/types.js';
import { ctftimeFixture, openTestGeo, type TestGeo } from './ctftime.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';
import {
  fakeTransport,
  manualSleeper,
  silentLogger,
  testScrapingHttp,
  type FakeResponse,
  type FakeTransport,
} from './scraping.js';

/**
 * A CTFtime run end to end on the fake transport: the real migrated database
 * with its seeded `ctftime` row, the real adapter, the real orchestrator, and a
 * transport that answers from WP-02's recordings. Nothing here can reach
 * ctftime.org — the fake answers only the URLs it is given.
 */

export const CTFTIME_ORIGIN = 'https://ctftime.org';
export const CTFTIME_ROBOTS_URL = `${CTFTIME_ORIGIN}/robots.txt`;

/** WP-02's capture of ctftime.org/robots.txt, the provenance copy. */
export function recordedCtftimeRobots(): string {
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
      'ctftime.org.txt',
    ),
    'utf8',
  );
}

/** The one listing URL a walk starting at `clock` asks for first. */
export function firstListingUrl(clock: Clock): string {
  const startSec = Math.floor(clock.now().getTime() / 1000);
  return listingUrl(
    CTFTIME_ORIGIN,
    { startSec, finishSec: startSec + LISTING_WINDOW_DAYS * 86_400 },
    100,
  );
}

/** Detail routes answering each event with its own recorded object. */
export function detailRoutes(events: readonly unknown[]): Record<string, FakeResponse> {
  const routes: Record<string, FakeResponse> = {};
  for (const event of events) {
    const id = (event as { id: number }).id;
    routes[detailUrl(CTFTIME_ORIGIN, id)] = { body: JSON.stringify(event) };
  }
  return routes;
}

export interface CtftimeRunHarness {
  readonly database: MigratedDatabase;
  readonly source: SourceRow;
  readonly adapter: SourceAdapter;
  readonly snapshots: SnapshotStore;
  readonly sleep: ReturnType<typeof manualSleeper>;
  deps(transport: FakeTransport): ScrapeRunDependencies;
  close(): void;
}

export function openCtftimeRun(clock: Clock): CtftimeRunHarness {
  const database = openMigratedDatabase(silentLogger, 'ctftime-run');
  const geo: TestGeo = openTestGeo();
  const sources = new SourcesRepository(database.db);
  const source = sources.findByKey('ctftime');
  if (source === undefined) {
    throw new Error('migration 0006 did not seed the ctftime row');
  }
  const snapshots = new SnapshotStore({ config: database.config, logger: silentLogger, clock });
  const sleep = manualSleeper();
  return {
    database,
    source,
    adapter: createCtftimeAdapter({ geo: geo.geocoder }),
    snapshots,
    sleep,
    deps: (transport) => ({
      sources,
      records: new SourceRecordsRepository(database.db),
      http: testScrapingHttp({ transport, clock, sleep }),
      snapshots,
      clock,
      logger: silentLogger,
      setupComplete: () => true,
    }),
    close: () => {
      geo.close();
      database.close();
    },
  };
}

/** The recorded listing plus robots and a detail route per event. */
export function recordedTransport(
  clock: Clock,
  listing: FakeResponse = { body: JSON.stringify(ctftimeFixture('listing-events.json')) },
): FakeTransport {
  const events = ctftimeFixture('listing-events.json') as unknown[];
  return fakeTransport({
    [CTFTIME_ROBOTS_URL]: { body: recordedCtftimeRobots() },
    [firstListingUrl(clock)]: listing,
    ...detailRoutes(events),
  });
}

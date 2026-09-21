import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Logger } from 'pino';

import { clistListingUrl, createClistAdapter, CLIST_ORIGIN } from '../adapters/clist/adapter.js';
import type { SourceRow } from '../db/schema/index.js';
import { createEventsModule, type EventsModule } from '../modules/events/wiring.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { AuditLog } from '../platform/audit.js';
import { SettingsStore } from '../platform/settings.js';
import type { Clock } from '../platform/time.js';
import type { SourceCredential } from '../scraping/http/index.js';
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
 * A CLIST run end to end on the fake transport (WP-11): the migrated database
 * with the seeded `clist` row (migration 0009), the real adapter, the real
 * orchestrator and linker. CLIST has never been called; every fixture is
 * synthetic and says so in its `_note`.
 */

export const CLIST_ROBOTS_URL = `${CLIST_ORIGIN}/robots.txt`;
export const CLIST_START = '2026-09-21T00:00:00.000Z';
export const TEST_CREDENTIAL: SourceCredential = {
  header: 'Authorization',
  value: 'ApiKey test-user:test-key-0123456789abcdef',
};

const DAY_MS = 86_400_000;

export function recordedClistRobots(): string {
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
      'clist.by.txt',
    ),
    'utf8',
  );
}

export function clistFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(fixturesDir(), 'clist', name), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** The listing page at `offset` for a walk starting at `clock`. */
export function pageUrl(clock: Clock, offset: number): string {
  const now = clock.now().getTime();
  return clistListingUrl(
    CLIST_ORIGIN,
    { from: new Date(now - DAY_MS), to: new Date(now + 90 * DAY_MS) },
    offset,
  );
}

/** A fixture as a fake response; `http-*` fixtures carry their own status. */
export function asResponse(name: string): FakeResponse {
  const fixture = clistFixture(name);
  if (typeof fixture.status === 'number') {
    return {
      status: fixture.status,
      headers: fixture.headers as Record<string, string>,
      body: JSON.stringify(fixture.body),
    };
  }
  return { body: JSON.stringify(fixture), headers: { 'content-type': 'application/json' } };
}

export function clistTransport(
  clock: Clock,
  pages: Readonly<Record<number, FakeResponse | readonly FakeResponse[]>>,
  extra: Readonly<Record<string, FakeResponse>> = {},
): FakeTransport {
  const routes: Record<string, FakeResponse | readonly FakeResponse[]> = {
    [CLIST_ROBOTS_URL]: { body: recordedClistRobots() },
    ...extra,
  };
  for (const [offset, response] of Object.entries(pages)) {
    routes[pageUrl(clock, Number(offset))] = response;
  }
  return fakeTransport(routes);
}

export interface ClistHarness {
  readonly database: MigratedDatabase;
  readonly source: SourceRow;
  readonly adapter: SourceAdapter;
  readonly events: EventsModule;
  readonly records: SourceRecordsRepository;
  readonly sources: SourcesRepository;
  readonly settings: SettingsStore;
  readonly snapshots: SnapshotStore;
  readonly clock: Clock & { advance(ms: number): void };
  readonly sleep: ReturnType<typeof manualSleeper>;
  deps(
    transport: FakeTransport,
    options?: { credential?: SourceCredential | undefined; logger?: Logger },
  ): ScrapeRunDependencies;
  close(): void;
}

export function openClistHarness(): ClistHarness {
  const database = openMigratedDatabase(silentLogger, 'clist');
  const clock = movableClock(CLIST_START);
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
  const source = sources.findByKey('clist');
  if (source === undefined) {
    throw new Error('migration 0006/0009 did not seed the clist row');
  }
  const records = new SourceRecordsRepository(database.db);
  const snapshots = new SnapshotStore({ config: database.config, logger: silentLogger, clock });
  const sleep = manualSleeper();
  return {
    database,
    source,
    adapter: createClistAdapter(),
    events,
    records,
    sources,
    settings,
    snapshots,
    clock,
    sleep,
    deps: (transport, options = {}) => {
      const logger = options.logger ?? silentLogger;
      return {
        sources,
        records,
        http: testScrapingHttp({ transport, clock, sleep, logger }),
        snapshots,
        clock,
        logger,
        setupComplete: () => true,
        linker: events.linker,
        credentials: () => ('credential' in options ? options.credential : TEST_CREDENTIAL),
      };
    },
    close: () => {
      geo.close();
      database.close();
    },
  };
}

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { users, type SourceRow } from '../db/schema/index.js';
import { EventImportService } from '../modules/events/import/service.js';
import { createEventsModule, type EventsModule } from '../modules/events/wiring.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import type { Principal } from '../modules/auth/types.js';
import { AuditLog } from '../platform/audit.js';
import { SettingsStore } from '../platform/settings.js';
import { SnapshotStore } from '../scraping/snapshots.js';
import { adapterRegistry, AdapterRegistry, registerBuiltInAdapters } from '../sources/registry.js';
import { openTestGeo, type TestGeo } from './ctftime.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';
import { fixturesDir } from './golden.js';
import {
  fakeTransport,
  movableClock,
  silentLogger,
  testScrapingHttp,
  type FakeResponse,
  type FakeTransport,
} from './scraping.js';

/**
 * Manual entry and URL import end to end on the fake transport (WP-14).
 *
 * The migrated database carries the seeded rows — including `manual` and
 * `url-import` from migration 0012 — and the real adapters, orchestrator pieces
 * and linker are wired exactly as `main.ts` wires them. The only double is the
 * transport, which is what lets a test assert "zero requests were made" as a
 * fact about the wire rather than a flag somebody set.
 */

export const IMPORT_START = '2026-09-22T09:00:00.000Z';

export const ALLOW_ALL = 'User-agent: *\nDisallow:\n';
export const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

export const ADMIN: Principal = {
  id: 'admin-import',
  email: 'admin@example.edu',
  displayName: 'A. Administrator',
  departmentId: null,
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: ['ADMINISTRATOR'],
};

export const PROFESSOR: Principal = { ...ADMIN, id: 'prof-import', roles: ['PROFESSOR'] };

export function importFixture(name: string): string {
  return readFileSync(path.join(fixturesDir(), 'url-import', name), 'utf8');
}

/** A fixture from another adapter's folder, served as that site would serve it. */
export function adapterFixture(source: string, name: string): string {
  return readFileSync(path.join(fixturesDir(), source, name), 'utf8');
}

export const HTML: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
};
export const JSON_TYPE: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
};

export interface ImportHarness {
  readonly database: MigratedDatabase;
  readonly sources: SourcesRepository;
  readonly records: SourceRecordsRepository;
  readonly events: EventsModule;
  readonly settings: SettingsStore;
  readonly service: EventImportService;
  readonly transport: FakeTransport;
  readonly clock: ReturnType<typeof movableClock>;
  readonly registry: AdapterRegistry;
  row(key: string): SourceRow;
  close(): void;
}

/** Every adapter this build ships, registered against the test geocoder. */
function registryWith(geo: TestGeo): AdapterRegistry {
  const registry = new AdapterRegistry();
  registerBuiltInAdapters(registry, { geo: geo.geocoder });
  return registry;
}

export function openImportHarness(
  routes: Readonly<Record<string, FakeResponse | readonly FakeResponse[]>> = {},
): ImportHarness {
  const database = openMigratedDatabase(silentLogger, 'import');
  const clock = movableClock(IMPORT_START);
  const geo = openTestGeo();
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
  const transport = fakeTransport(routes);
  const registry = registryWith(geo);
  const snapshots = new SnapshotStore({ config: database.config, logger: silentLogger, clock });
  const at = clock.now().getTime();
  for (const actor of [ADMIN, PROFESSOR]) {
    database.db.drizzle
      .insert(users)
      .values({
        id: actor.id,
        email: `${actor.id}@example.edu`,
        displayName: actor.displayName,
        passwordHash: 'not-a-real-hash',
        createdAt: at,
        updatedAt: at,
      })
      .run();
  }
  const service = new EventImportService({
    sources,
    records,
    linker: events.linker,
    provenance: events.provenance,
    resolver: events.resolver,
    geocoder: geo.geocoder,
    registry,
    http: testScrapingHttp({ transport, clock }),
    audit,
    logger: silentLogger,
    clock,
    snapshots,
  });
  return {
    database,
    sources,
    records,
    events,
    settings,
    service,
    transport,
    clock,
    registry,
    row: (key: string) => {
      const row = sources.findByKey(key);
      if (row === undefined) {
        throw new Error(`no seeded source "${key}"`);
      }
      return row;
    },
    close: () => {
      geo.close();
      database.close();
    },
  };
}

/** The process-wide registry, for a test that needs `main.ts`'s own wiring. */
export { adapterRegistry };

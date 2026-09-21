import { AuthRepository } from '../modules/auth/repository.js';
import { AuthService } from '../modules/auth/service.js';
import { SetupRepository } from '../modules/setup/repository.js';
import { SetupService } from '../modules/setup/service.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { SourcesService } from '../modules/sources/service.js';
import { UsersRepository } from '../modules/users/repository.js';
import { UsersService } from '../modules/users/service.js';
import { AdapterRegistry } from '../sources/registry.js';
import { Geocoder } from '../modules/geo/geocoder.js';
import { createSearchModule, type SearchModule } from '../modules/search/wiring.js';
import { createCategoriesModule, type CategoriesModule } from '../modules/categories/wiring.js';
import { EventUserStateService } from '../modules/events/user-state.js';
import { createEventsModule, type EventsModule } from '../modules/events/wiring.js';
import { EventImportService } from '../modules/events/import/service.js';
import { unavailableGazetteer } from '../platform/gazetteer.js';
import { fakeTransport, silentLogger, testScrapingHttp } from './scraping.js';
import { systemClock } from '../platform/time.js';
import { AuditLog } from '../platform/audit.js';
import { SettingsStore } from '../platform/settings.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';
import { startTestServer, type TestServer } from './harness.js';
import { makeTempDir, removeTempDir } from './temp.js';

/**
 * A real server on a **completely empty** database — no organization, no admin —
 * which is the only state the setup module is ever exercised in.
 *
 * It wires the real `SetupService`, `UsersService` and `AuthService` against one
 * database, exactly as `main.ts` does, because the R39 gate is a property of how
 * those three are hooked together and a stub would prove nothing.
 */

export interface SetupTestServer {
  readonly server: TestServer;
  readonly database: MigratedDatabase;
  readonly setup: SetupService;
  readonly users: UsersService;
  readonly auth: AuthService;
  readonly sources: SourcesService;
  /** WP-14's manual entry and URL import. */
  readonly imports: EventImportService;
  /** WP-10's linker, merges and review API, on the same database. */
  readonly events: EventsModule;
  /** WP-15a's search, detail and aliases. */
  readonly search: SearchModule;
  /** WP-15b's categories, classifying every event the linker resolves. */
  readonly categories: CategoriesModule;
  /** Empty in WP-09a; a test registers an adapter when it needs one. */
  readonly registry: AdapterRegistry;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  /** A folder outside the data directory that a backup destination may use. */
  readonly backupDir: string;
  /** The process data directory the R43 check compares against. */
  readonly dataDir: string;
  close(): Promise<void>;
}

export interface SetupTestServerOptions {
  /** Lowered in the low-space test; defaults to the real 1 GB floor. */
  readonly minFreeBytes?: number;
  /** Injected so a test can make the repository's write throw (R40). */
  readonly repository?: SetupRepository;
}

export async function startSetupTestServer(
  options: SetupTestServerOptions = {},
): Promise<SetupTestServer> {
  const database = openMigratedDatabase(undefined, 'setup');
  const dataDir = database.config.dataDir;
  // A sibling of the data directory, never inside it: R43 refuses that on purpose.
  const backupDir = makeTempDir('setup-backups');

  const settings = new SettingsStore(database.db);
  const audit = new AuditLog(database.db);
  const authRepository = new AuthRepository(database.db);
  const auth = new AuthService({ repository: authRepository, settings, audit });

  const setup = new SetupService({
    repository: options.repository ?? new SetupRepository(database.db),
    settings,
    audit,
    dataDir,
    appVersion: '0.1.0-test',
    ...(options.minFreeBytes === undefined ? {} : { minFreeBytes: options.minFreeBytes }),
  });
  const users = new UsersService({
    repository: new UsersRepository(database.db),
    auth: authRepository,
    audit,
    onAdministratorsChanged: () => {
      setup.invalidate();
    },
  });

  // The source module, wired to a transport that answers nothing: the route
  // tests are about permissions, versions and the manual floor, and a request
  // that reached the network would mean one of those had already failed.
  const registry = new AdapterRegistry();
  const sources = new SourcesService({
    sources: new SourcesRepository(database.db),
    records: new SourceRecordsRepository(database.db),
    registry,
    audit,
    logger: silentLogger,
    settings,
    runtime: {
      http: testScrapingHttp({ transport: fakeTransport({}), clock: systemClock }),
      setupComplete: () => !setup.isRequired(),
    },
  });

  const categories = createCategoriesModule({ db: database.db, audit });
  const events = createEventsModule({
    db: database.db,
    geocoder: new Geocoder({ gazetteer: unavailableGazetteer('tests'), institutions: [] }),
    settings,
    audit,
    logger: silentLogger,
    onResolved: (eventId, at) => {
      categories.classifier.classifyEvent(eventId, at);
    },
  });

  // WP-14: manual entry and URL import, on the same database and the same
  // silent transport — the route tests are about permissions and problem
  // details, and a request that reached the network would mean the dispatch
  // had already failed.
  const imports = new EventImportService({
    sources: new SourcesRepository(database.db),
    records: new SourceRecordsRepository(database.db),
    linker: events.linker,
    provenance: events.provenance,
    resolver: events.resolver,
    geocoder: new Geocoder({ gazetteer: unavailableGazetteer('tests'), institutions: [] }),
    registry,
    http: testScrapingHttp({ transport: fakeTransport({}), clock: systemClock }),
    audit,
    logger: silentLogger,
  });

  const userState = new EventUserStateService({ db: database.db, events: events.events });
  const search = createSearchModule({ db: database.db, audit, events: events.events, settings });

  const server = await startTestServer({
    search: () => search,
    categories: () => categories.admin,
    userState: () => userState,
    auth: () => auth,
    setup: () => setup,
    users: () => users,
    sources: () => sources,
    review: () => events.review,
    imports: () => imports,
  });

  return {
    server,
    database,
    setup,
    users,
    auth,
    sources,
    imports,
    events,
    search,
    categories,
    registry,
    settings,
    audit,
    backupDir,
    dataDir,
    close: async () => {
      await server.close();
      database.close();
      removeTempDir(backupDir);
    },
  };
}

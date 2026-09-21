import type { HealthDatabase, ReadyLine } from '@compintel/contracts';
import type { Logger } from 'pino';

import { buildApp, type App } from './app.js';
import { hasNetworkInterface } from './jobs/online.js';
import { Scheduler } from './jobs/scheduler.js';
import { JobStore } from './jobs/store.js';
import { setArgon2BindingPath } from './modules/auth/argon2-binding.js';
import { AuthRepository } from './modules/auth/repository.js';
import { AuthService } from './modules/auth/service.js';
import { SetupRepository } from './modules/setup/repository.js';
import { SetupService } from './modules/setup/service.js';
import { UsersRepository } from './modules/users/repository.js';
import { UsersService } from './modules/users/service.js';
import { AuditLog } from './platform/audit.js';
import { ensureDataDirs, loadConfig, writeDevConnectionFile } from './platform/config.js';
import { openDatabase } from './platform/db.js';
import { installLifecycle } from './platform/lifecycle.js';
import { acquireDataDirLock } from './platform/lock.js';
import { createLogger, type LoggerHandle } from './platform/logger.js';
import { recordAppMeta, runMigrations } from './platform/migrate.js';
import { AUTO_LOCK_MINUTES } from './settings.js';
import { resolveResources } from './platform/resources.js';
import { SettingsStore } from './platform/settings.js';
import { ShutdownRegistry } from './platform/shutdown.js';
import { StartupError, toStartupFailure } from './platform/startup-error.js';
import { openGazetteer, unavailableGazetteer } from './platform/gazetteer.js';
import { nowMs, systemClock } from './platform/time.js';
import { Geocoder } from './modules/geo/geocoder.js';
import { loadInstitutions, loadSeedFile, seedInstitutions } from './modules/geo/seed.js';
import { EventsRepository } from './modules/events/repository.js';
import { EventsService } from './modules/events/service.js';
import { applyCategorySeed, loadCategorySeed } from './modules/categories/seed.js';
import {
  createCategoriesModule,
  RECLASSIFY_JOB_KEY,
  registerReclassifyJob,
} from './modules/categories/wiring.js';
import { createEventsModule } from './modules/events/wiring.js';
import { createSearchModule } from './modules/search/wiring.js';
import { SourceRecordsRepository } from './modules/sources/records.js';
import { SourcesRepository } from './modules/sources/repository.js';
import { SourcesService } from './modules/sources/service.js';
import { resolveCredential, seedDevCredentials } from './modules/sources/credentials.js';
import { resolveSessionCredential } from './modules/sources/session.js';
import { createSessionHooks } from './scraping/sessions.js';
import { EventImportService } from './modules/events/import/service.js';
import type { SourceRow } from './db/schema/index.js';
import {
  HttpCacheStore,
  ScrapingHttp,
  type SourceCredential,
  closeTransport,
  undiciFetcher,
} from './scraping/http/index.js';
import { registerScrapeJobs } from './scraping/jobs.js';
import { SnapshotStore } from './scraping/snapshots.js';
import { SCRAPER_CONTACT_EMAIL } from './modules/org/settings.js';
import { adapterRegistry, registerBuiltInAdapters } from './sources/registry.js';
import './settings.js';

/**
 * The one and only thing this process writes to stdout (ruling R7). The callback
 * form matters: stdout is a pipe when the shell spawns us, so the line must be
 * flushed before `process.exit`.
 */
function writeReadyLine(line: ReadyLine): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify(line)}\n`, () => {
      resolve();
    });
  });
}

async function failStart(error: unknown, logger?: Logger): Promise<never> {
  const failure = toStartupFailure(error);
  logger?.fatal({ err: error, code: failure.code }, 'backend failed to start');
  await writeReadyLine({ ready: false, error: failure });
  process.exit(1);
}

function listeningPort(app: App): number {
  const address = app.server.server.address();
  if (address === null || typeof address !== 'object') {
    throw new StartupError('LISTEN_FAILED', 'The server reported no TCP address after listening.');
  }
  return address.port;
}

async function main(): Promise<void> {
  let loggerHandle: LoggerHandle | undefined;
  try {
    const config = loadConfig();
    ensureDataDirs(config);

    loggerHandle = createLogger(config);
    const logger = loggerHandle.logger;

    // Registered first, released last: the lock outlives everything it protects.
    const shutdown = new ShutdownRegistry();
    const lock = acquireDataDirLock(config, logger);
    shutdown.register('resources', 'data-dir-lock', lock.release);

    const resources = resolveResources(config, import.meta.url);
    // R17: in the bundle both addons are named explicitly; in a checkout this is
    // `undefined` and normal module resolution finds them.
    setArgon2BindingPath(resources.argon2Binding);
    const db = openDatabase(config, { logger, shutdown, nativeBinding: resources.nativeBinding });
    const migrations = runMigrations(config, db, {
      migrationsDir: resources.migrationsDir,
      logger,
    });
    recordAppMeta(config, db);

    // Accounts and sessions (§4.12, §10). Built before the HTTP layer because
    // every guarded route resolves through it on the way in.
    const settings = new SettingsStore(db, {
      onInvalid: (key, reason) => {
        logger.warn({ setting: key, reason }, 'a stored setting was unreadable; using the default');
      },
    });
    const audit = new AuditLog(db);
    const authRepository = new AuthRepository(db);
    const auth = new AuthService({ repository: authRepository, settings, audit });

    // The first-run wizard (rulings R39-R44) and user administration. The setup
    // service also owns the gate's cached answer, so anything that changes the
    // administrator population tells it to look again.
    const setup = new SetupService({
      repository: new SetupRepository(db),
      settings,
      audit,
      dataDir: config.dataDir,
      appVersion: config.appVersion,
    });
    const users = new UsersService({
      repository: new UsersRepository(db),
      auth: authRepository,
      audit,
      onAdministratorsChanged: () => {
        setup.invalidate();
      },
    });

    // Geography (§4.17, rulings R53-R55). The gazetteer is reference data the
    // build produces; a missing one is a warning and a geocoder that answers
    // UNKNOWN, never a failed start (R54). The institutions seed is idempotent,
    // so running it every start costs one query and keeps a fresh install
    // correct without a separate step.
    const gazetteer =
      resources.gazetteerFile === undefined
        ? unavailableGazetteer('no gazetteer was built; run `pnpm gazetteer:build`')
        : openGazetteer(resources.gazetteerFile, { logger, shutdown });
    if (!gazetteer.available) {
      logger.warn(
        { reason: gazetteer.unavailableReason },
        'geocoding will answer UNKNOWN until a gazetteer is built',
      );
    }
    const seeded = seedInstitutions(db, audit, {
      ...(resources.institutionsSeedFile === undefined
        ? {}
        : { seed: loadSeedFile(resources.institutionsSeedFile) }),
    });
    logger.info(seeded, 'institutions seeded');
    const geocoder = new Geocoder({ gazetteer, institutions: loadInstitutions(db) });
    const eventsService = new EventsService({
      repository: new EventsRepository(db),
      geocoder,
      settings,
      audit,
    });
    // Only the §19 policy re-evaluation uses it; ingest goes through WP-10's
    // linker below. Constructed here so a startup failure surfaces at startup.
    void eventsService;
    // WP-15b: categories. Built before the events module, whose resolver
    // classifies every event it resolves; the seed is data, applied once per
    // version, and a rule edit's re-classification runs as a job (below).
    const reclassify: { trigger: () => void } = { trigger: () => undefined };
    const categoriesModule = createCategoriesModule({
      db,
      audit,
      logger,
      onRunRequested: () => {
        reclassify.trigger();
      },
    });
    if (resources.categoriesSeedFile === undefined) {
      logger.warn('no category seed file was found; the category list starts empty');
    } else {
      const seeded = applyCategorySeed(
        db,
        loadCategorySeed(resources.categoriesSeedFile),
        nowMs(systemClock),
      );
      logger.info(seeded, 'category seed');
      if (seeded.categoriesAdded + seeded.rulesAdded > 0) {
        categoriesModule.classifier.requestReclassification('category seed applied', null);
      }
    }
    // WP-10: records become events inline with ingest; merges and the review API.
    const eventsModule = createEventsModule({
      db,
      geocoder,
      settings,
      audit,
      logger,
      onResolved: (eventId, at) => {
        categoriesModule.classifier.classifyEvent(eventId, at);
      },
    });
    // WP-15a: search, event detail and aliases. The vocabulary is rebuilt at
    // start (cheap, and a restored database may carry a stale one) and after
    // every ingest.
    const searchModule = createSearchModule({
      db,
      audit,
      events: eventsModule.events,
      logger,
      settings,
    });
    searchModule.vocabulary.refresh();
    const refreshVocabulary = (): void => {
      try {
        searchModule.vocabulary.refresh();
      } catch (error) {
        // The write already committed; a stale vocabulary only weakens typo hints.
        logger.error({ err: error }, 'refreshing the search vocabulary failed');
      }
    };

    // Event ingestion (§7, rulings R58-R61). The transport is the only place a
    // socket is opened, and it is injected here and nowhere else: every test
    // passes a fake, which is what makes "no test opens an internet socket"
    // something the wiring guarantees rather than something a reviewer checks.
    const scrapingHttp = new ScrapingHttp({
      fetcher: undiciFetcher,
      logger,
      cache: new HttpCacheStore(db),
      appVersion: config.appVersion,
      contactEmail: () => settings.get(SCRAPER_CONTACT_EMAIL),
      // A10/R44: nothing is contacted before the wizard has finished.
      setupComplete: () => !setup.isRequired(),
      hasNetworkInterface,
    });
    shutdown.register('resources', 'scraping-transport', closeTransport);
    const snapshots = new SnapshotStore({ config, logger });
    registerBuiltInAdapters(adapterRegistry, { geo: geocoder });
    const sourcesRepository = new SourcesRepository(db);
    const sourceRecords = new SourceRecordsRepository(db);
    // WP-11: in --dev only, env vars may seed the CLIST credential (never logged).
    if (seedDevCredentials(settings, config.dev, process.env)) {
      logger.info('a CLIST credential was seeded from the environment (--dev)');
    }
    // WP-11's documented API key, or — for the two sources R74 allows it —
    // the professor's own session. A source has at most one of the two, and a
    // session that the site has already rejected is not sent at all.
    const credentials = (source: SourceRow): SourceCredential | undefined =>
      resolveCredential(source, settings) ?? resolveSessionCredential(source, settings);
    const sessions = createSessionHooks(settings);
    const scrapeRuntime = {
      http: scrapingHttp,
      snapshots,
      linker: eventsModule.linker,
      credentials,
      sessions,
      setupComplete: () => !setup.isRequired(),
    };
    const imports = new EventImportService({
      sources: sourcesRepository,
      records: sourceRecords,
      linker: eventsModule.linker,
      provenance: eventsModule.provenance,
      resolver: eventsModule.resolver,
      geocoder,
      registry: adapterRegistry,
      http: scrapingHttp,
      audit,
      logger,
      snapshots,
      credentials,
      onIngested: refreshVocabulary,
    });
    const sourcesService = new SourcesService({
      sources: sourcesRepository,
      records: sourceRecords,
      registry: adapterRegistry,
      audit,
      logger,
      settings,
      runtime: scrapeRuntime,
      onIngested: refreshVocabulary,
    });

    // Constructed before the HTTP layer so its `resources` hook is registered
    // even if the process is asked to stop during startup (R14); started only
    // once we are listening. Jobs themselves are registered by the work packages
    // that own them (deadlines in WP-22, backups in WP-28); the scrape jobs
    // below are WP-09a's, and there are none until an adapter is registered.
    const scheduler = new Scheduler({
      store: new JobStore(db),
      logger,
      shutdown,
      isOnline: hasNetworkInterface,
    });
    const scrapeJobs = registerScrapeJobs(scheduler, {
      sources: sourcesService,
      registry: adapterRegistry,
      runtime: {
        records: sourceRecords,
        http: scrapingHttp,
        snapshots,
        clock: systemClock,
        logger,
        linker: eventsModule.linker,
      },
      logger,
    });
    logger.info({ scrapeJobs, adapters: adapterRegistry.size }, 'scrape jobs registered');
    registerReclassifyJob(scheduler, categoriesModule.classifier);
    reclassify.trigger = () => {
      scheduler.trigger(RECLASSIFY_JOB_KEY);
    };

    // The shutdown route needs the trigger, which needs the built app; one
    // mutable hop breaks the cycle without leaking process concerns into app.ts.
    const lifecycle: { start: (reason: string) => void } = { start: () => undefined };
    const app = buildApp(config, logger, {
      shutdown,
      auth: () => auth,
      setup: () => setup,
      users: () => users,
      sources: () => sourcesService,
      imports: () => imports,
      review: () => eventsModule.review,
      search: () => searchModule,
      categories: () => categoriesModule.admin,
      onShutdownRequested: () => {
        lifecycle.start('api');
      },
      database: (): HealthDatabase => ({
        ok: db.isHealthy(),
        migrationsApplied: migrations.total,
      }),
    });

    const installed = installLifecycle({ config, app, loggerHandle });
    lifecycle.start = installed.start;
    if (installed.isShuttingDown()) {
      // The shell was already gone when we got here; never bind a socket.
      return;
    }

    await app.server.listen({ host: config.host, port: config.port });
    const port = listeningPort(app);
    await scheduler.start();

    if (config.dev && config.clientSecretGenerated) {
      const file = writeDevConnectionFile(config, port);
      logger.warn({ file }, 'dev mode generated a client secret and wrote it to disk');
    }

    logger.info(
      {
        port,
        dataDir: config.dataDir,
        migrationsApplied: migrations.applied,
        migrationsTotal: migrations.total,
        jobs: scheduler.registered().length,
        autoLockMinutes: settings.get(AUTO_LOCK_MINUTES),
      },
      'backend listening',
    );
    await writeReadyLine({
      ready: true,
      port,
      pid: process.pid,
      appVersion: config.appVersion,
      apiVersion: config.apiVersion,
    });
  } catch (error) {
    await failStart(error, loggerHandle?.logger);
  }
}

await main();

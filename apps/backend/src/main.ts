import type { HealthDatabase } from '@compintel/contracts';

import { buildApp } from './app.js';
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
import { failStart, listeningPort, writeReadyLine } from './platform/ready-line.js';
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
import { createStudentsModule } from './modules/students/wiring.js';
import { createTeamsModule } from './modules/teams/wiring.js';
import { createEngagementsModule } from './modules/engagements/wiring.js';
import { TemplatesRepository } from './modules/workflows/templates-repo.js';
import { createWorkflowsModule } from './modules/workflows/wiring.js';
import { createResourcesModule } from './modules/resources/wiring.js';
import { createOutcomeLookup, createOutcomesModule } from './modules/outcomes/wiring.js';
import { createTransferModule } from './modules/transfer/wiring.js';
import { createDeadlinesModule } from './modules/deadlines/wiring.js';
import { KpiService } from './modules/dashboard/kpis.js';
import { registerDeadlineEvaluator } from './modules/deadlines/evaluator.js';
import { createNotificationsModule } from './modules/notifications/wiring.js';
import { createSavedSearchesModule } from './modules/saved-searches/wiring.js';
import { InterestsRepository } from './modules/interests/repo.js';
import { InterestsService } from './modules/interests/service.js';
import { EventUserStateService } from './modules/events/user-state.js';
import { createEventsModule } from './modules/events/wiring.js';
import { createSearchModule } from './modules/search/wiring.js';
import { createSourcesModule } from './modules/sources/wiring.js';
import { registerScrapeJobs } from './scraping/jobs.js';
import { StreamHub } from './platform/stream.js';
import { adapterRegistry } from './sources/registry.js';
import './settings.js';

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
      // R101: the default workflow templates arrive with the department.
      onCompleted: (_departmentId, at) => {
        new TemplatesRepository(db).ensureSeeded(at);
      },
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
      categories: categoriesModule.repo,
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
    // WP-16a: a professor's own Save and Hide.
    const userState = new EventUserStateService({ db, events: eventsModule.events });
    // WP-17: students, mentorships and the import.
    const studentsModule = createStudentsModule({ db, audit, settings });
    // WP-18: teams, members and mentors.
    const teamsModule = createTeamsModule({ db, audit });
    // WP-20a: workflow templates — the five defaults, inserted if absent (R101) —
    // and the workflow copied in as a competition enters ASSIGNED.
    const workflowsModule = createWorkflowsModule({ db, audit });
    workflowsModule.templatesRepository.ensureSeeded(Date.now());
    // WP-20b: references attached to a competition, its stages, tasks and outcome.
    const resourcesModule = createResourcesModule({ db, audit });
    // WP-21: outcomes — read by the competitions module, written through it.
    const outcomes = createOutcomeLookup(db, resourcesModule);
    // WP-19: competitions, with WP-20a's copy-on-assign and progress/health.
    const competitionsModule = createEngagementsModule({
      db,
      audit,
      onAssigned: [workflowsModule.copier.onAssigned],
      summaries: (rows) => workflowsModule.reader.summaries(rows),
      outcomes: outcomes.lookup,
    });
    const outcomesModule = createOutcomesModule({
      repository: outcomes.repository,
      competitions: competitionsModule,
      resources: resourcesModule,
      audit,
    });
    // WP-21: an admin's ownership transfer (R105).
    const transferModule = createTransferModule({ db, audit });
    // WP-22: the deadline read model (v_deadlines) for the Radar, KPIs and evaluator.
    const deadlinesModule = createDeadlinesModule({ db });
    // WP-22: each KPI is its list's own total (R107).
    const kpis = new KpiService({
      search: () => searchModule,
      competitions: () => competitionsModule,
      deadlines: () => deadlinesModule,
    });
    const refreshVocabulary = (): void => {
      try {
        searchModule.vocabulary.refresh();
      } catch (error) {
        // The write already committed; a stale vocabulary only weakens typo hints.
        logger.error({ err: error }, 'refreshing the search vocabulary failed');
      }
    };

    // Event ingestion (§7, rulings R58-R61), and everything that reads a source:
    // the transport, the adapters, the session vault (R76) and the services over
    // them. `modules/sources/wiring.ts` holds the order they have to be built in.
    //
    // The SSE hub is created here rather than inside `buildApp` because a scrape
    // run is announced on it (R86) and runs start before the first request: one
    // hub, passed to both halves, is what keeps "one per process" true.
    const streamHub = new StreamHub();
    const sourcesModule = createSourcesModule({
      db,
      config,
      settings,
      audit,
      logger,
      shutdown,
      geocoder,
      events: eventsModule,
      setupComplete: () => !setup.isRequired(),
      onIngested: refreshVocabulary,
      onRunFinished: (event) => {
        streamHub.publish('source.run.finished', { ...event });
      },
    });
    const sourcesService = sourcesModule.service;

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
      runtime: { ...sourcesModule.scrapeRuntime, clock: systemClock, logger },
      logger,
    });
    logger.info({ scrapeJobs, adapters: adapterRegistry.size }, 'scrape jobs registered');
    registerReclassifyJob(scheduler, categoriesModule.classifier);
    // WP-22: offline, every 5 min; WP-23's notifications are its sink (R108-R111).
    const notificationsModule = createNotificationsModule({ db, hub: streamHub });
    notificationsModule.attachToEvaluator();
    registerDeadlineEvaluator(scheduler, deadlinesModule);
    // WP-24: hourly, and after every SUCCESS/PARTIAL scrape run (R86, R112).
    const savedSearchesModule = createSavedSearchesModule({
      db,
      search: searchModule.service,
      notifications: notificationsModule.engine,
    });
    savedSearchesModule.schedule(scheduler, streamHub);
    const interests = new InterestsService({ repo: new InterestsRepository(db) });
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
      connectPrompt: () => sourcesModule.connectPrompt,
      imports: () => sourcesModule.imports,
      streamHub,
      review: () => eventsModule.review,
      search: () => searchModule,
      categories: () => categoriesModule.admin,
      userState: () => userState,
      eventDetail: () => eventsModule.detail,
      eventCategories: () => eventsModule.categoryOverrides,
      students: () => studentsModule,
      teams: () => teamsModule,
      competitions: () => competitionsModule,
      workflows: () => workflowsModule,
      resources: () => resourcesModule,
      outcomes: () => outcomesModule,
      transfer: () => transferModule,
      deadlines: () => deadlinesModule,
      kpis: () => kpis,
      notifications: () => notificationsModule,
      savedSearches: () => savedSearchesModule.service,
      interests: () => interests,
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

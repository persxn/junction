export { buildApp, API_PREFIX, BODY_LIMIT_BYTES, type App, type BuildAppOptions } from './app.js';
export * as schema from './db/schema/index.js';
export { applyCategorySeed, loadCategorySeed } from './modules/categories/seed.js';
export { createCategoriesModule, type CategoriesModule } from './modules/categories/wiring.js';
export {
  ensureDataDirs,
  loadConfig,
  writeDevConnectionFile,
  DATA_SUBDIRS,
  DEV_CONNECTION_FILE,
  LOG_LEVELS,
  type Config,
  type ConfigSources,
  type LogLevel,
} from './platform/config.js';
export {
  databaseFile,
  openDatabase,
  quickCheck,
  readPragmas,
  DATABASE_FILE,
  EXPECTED_PRAGMA_VALUES,
  REQUIRED_PRAGMAS,
  type DatabaseHandle,
  type OpenDatabaseOptions,
} from './platform/db.js';
export {
  AppError,
  registerErrorHandling,
  PROBLEM_CONTENT_TYPE,
  REQUEST_ID_HEADER,
  type AppErrorInit,
} from './platform/errors.js';
export { createUuid7, uuid7, type Uuid7Generator } from './platform/ids.js';
export {
  applyJitter,
  applyOutcome,
  executeRun,
  backoffDelayMs,
  firstDueAt,
  hasNetworkInterface,
  isDue,
  isLeaseExpired,
  JobStore,
  nextDueAfterRun,
  registerable,
  Scheduler,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS,
  DEFAULT_CONCURRENCY_LIMITS,
  DEFAULT_DRAIN_TIMEOUT_MS,
  DEFAULT_JITTER_RATIO,
  DEFAULT_LEASE_MS,
  TICK_INTERVAL_MS,
  TRIGGER_REFUSALS,
  type ApplyOutcomeOptions,
  type ExecuteRunOptions,
  type JobContext,
  type JobDefinition,
  type JobRunResult,
  type JobStatePatch,
  type RegisteredJob,
  type SchedulerOptions,
  type TickSummary,
  type TriggerRefusal,
  type TriggerResult,
} from './jobs/index.js';
export {
  bestMatch,
  boundingBox,
  distanceBucketKm,
  formatDistanceKm,
  haversineKm,
  haversineKmRaw,
  nameKey,
  nameTokens,
  normalizeName,
  tokenSetScore,
  tokenWeights,
  withinBoundingBox,
  EARTH_RADIUS_KM,
  NAME_MATCH_THRESHOLD,
  TIE_MARGIN,
  type BoundingBox,
  type NameMatch,
  type Nameable,
  type Point,
} from './domain/geo/index.js';
export {
  applyEventTypePolicy,
  applyGeographyPolicy,
  applyPolicies,
  UNCERTAIN_TYPE_BELOW,
  type EventTypeFacts,
  type GeographyFacts,
  type PolicyDecision,
  type PolicyFacts,
} from './domain/policy/index.js';
export { Geocoder, type GeocodeResult } from './modules/geo/geocoder.js';
export { openGazetteer, type Gazetteer } from './platform/gazetteer.js';
export { acquireDataDirLock, lockPath, LOCK_FILE, type DataDirLock } from './platform/lock.js';
export { createLogger, LOG_RETENTION_FILES, type LoggerHandle } from './platform/logger.js';
export {
  prunePreMigrationCopies,
  recordAppMeta,
  runMigrations,
  MIGRATIONS_TABLE,
  PRE_MIGRATION_RETENTION,
  type MigrationResult,
  type RunMigrationsOptions,
} from './platform/migrate.js';
export { redactDeep, REDACTED, SENSITIVE_KEY_PATTERN } from './platform/redact.js';
export { pathOf, registerRequestLogging, routeOf } from './platform/request-log.js';
export {
  resolveResources,
  BUNDLED_NATIVE_BINDING,
  type ResourcePaths,
} from './platform/resources.js';
export { DailyRotatingFile, type DailyRotatingFileOptions } from './platform/rotating-file.js';
export {
  registerSecurity,
  secretMatches,
  ALLOWED_HEADERS,
  ALLOWED_ORIGINS,
  CLIENT_SECRET_HEADER,
} from './platform/security.js';
export {
  ShutdownRegistry,
  SHUTDOWN_PHASES,
  type ShutdownHook,
  type ShutdownPhase,
} from './platform/shutdown.js';
export { StartupError, toStartupFailure } from './platform/startup-error.js';
export { APP_VERSION } from './platform/version.js';
export { AuditLog } from './platform/audit.js';
export { fixedClock, type Clock } from './platform/time.js';
export { EventsRepository } from './modules/events/repository.js';
export { createSearchModule, type SearchModule } from './modules/search/wiring.js';

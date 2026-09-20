export { buildApp, API_PREFIX, BODY_LIMIT_BYTES, type App, type BuildAppOptions } from './app.js';
export * as schema from './db/schema/index.js';
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

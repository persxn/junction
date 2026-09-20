export { buildApp, API_PREFIX, BODY_LIMIT_BYTES, type App, type BuildAppOptions } from './app.js';
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
  AppError,
  registerErrorHandling,
  PROBLEM_CONTENT_TYPE,
  REQUEST_ID_HEADER,
  type AppErrorInit,
} from './platform/errors.js';
export { createLogger, LOG_RETENTION_FILES, type LoggerHandle } from './platform/logger.js';
export { redactDeep, REDACTED, SENSITIVE_KEY_PATTERN } from './platform/redact.js';
export { DailyRotatingFile, type DailyRotatingFileOptions } from './platform/rotating-file.js';
export {
  registerSecurity,
  secretMatches,
  ALLOWED_HEADERS,
  ALLOWED_ORIGINS,
  CLIENT_SECRET_HEADER,
} from './platform/security.js';
export { ShutdownRegistry, type ShutdownHook } from './platform/shutdown.js';
export { StartupError, toStartupFailure } from './platform/startup-error.js';
export { APP_VERSION } from './platform/version.js';

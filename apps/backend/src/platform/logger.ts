import {
  multistream,
  pino,
  stdTimeFunctions,
  type Level,
  type Logger,
  type LoggerOptions,
  type StreamEntry,
} from 'pino';

import { dataSubdir, type Config } from './config.js';
import { redactDeep } from './redact.js';
import { DailyRotatingFile } from './rotating-file.js';

/** How many daily log files are kept (ARCHITECTURE.md 4.14, ruling R8). */
export const LOG_RETENTION_FILES = 14;

export interface LoggerOverrides {
  /** Injected in tests; defaults to the host machine's local clock. */
  readonly clock?: () => Date;
  /** Defaults to `<dataDir>\logs`. */
  readonly directory?: string;
}

export interface LoggerHandle {
  readonly logger: Logger;
  /** The file currently being appended to, once the first line has been written. */
  currentFile(): string | undefined;
  /** Flushes and closes the file destination. Safe to call twice. */
  close(): void;
}

/**
 * pino over `pino.multistream`: a daily-rotating file destination always, plus
 * stderr in `--dev`. Nothing here writes to stdout - that channel carries only
 * the READY line (ruling R7).
 */
export function createLogger(config: Config, overrides: LoggerOverrides = {}): LoggerHandle {
  const file = new DailyRotatingFile({
    directory: overrides.directory ?? dataSubdir(config, 'logs'),
    keep: LOG_RETENTION_FILES,
    ...(overrides.clock === undefined ? {} : { clock: overrides.clock }),
  });

  // `silent` belongs on the logger, not on a stream entry: the logger gates first,
  // so nothing ever reaches the streams.
  const streamLevel: Level = config.logLevel === 'silent' ? 'fatal' : config.logLevel;
  const streams: StreamEntry<Level>[] = [{ level: streamLevel, stream: file }];
  if (config.dev) {
    streams.push({ level: streamLevel, stream: process.stderr });
  }

  const options: LoggerOptions = {
    level: config.logLevel,
    timestamp: stdTimeFunctions.isoTime,
    base: { pid: process.pid, appVersion: config.appVersion },
    formatters: { log: redactDeep },
  };

  const logger = pino(options, multistream(streams, { dedupe: false }));

  return {
    logger,
    currentFile: () => file.currentFile,
    close: () => {
      file.close();
    },
  };
}

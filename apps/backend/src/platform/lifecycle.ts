import type { App } from '../app.js';
import type { Config } from './config.js';
import type { LoggerHandle } from './logger.js';

/** How long a graceful shutdown may take before the process is killed (§3.2). */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Signals Windows can actually deliver to a console process. */
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const;

export interface Lifecycle {
  /** Starts the graceful shutdown; safe to call more than once. */
  readonly start: (reason: string) => void;
  readonly isShuttingDown: () => boolean;
  /** Resolves once the shutdown has run, for tests that inject `exit`. */
  readonly whenSettled: () => Promise<void>;
}

/** The parts of `process` this module touches, so a test can supply its own. */
export interface LifecycleDeps {
  readonly config: Config;
  readonly app: App;
  readonly loggerHandle: LoggerHandle;
  /** Defaults to `process.exit`. */
  readonly exit?: (code: number) => void;
  /** Defaults to `process.stdin`. */
  readonly stdin?: NodeJS.ReadStream;
  /** Defaults to true; a test that installs several lifecycles turns it off. */
  readonly attachSignals?: boolean;
  readonly timeoutMs?: number;
}

/**
 * Wires the process into the shutdown paths from ARCHITECTURE.md §3.2. Ruling R14
 * fixes the order: `streams` hooks first (so nothing is cut off mid-response),
 * then stop accepting, then `resources` hooks (database, scheduler, LLM), then
 * flush the log. A hook that failed, or a run longer than `timeoutMs`, exits 1.
 */
export function installLifecycle(deps: LifecycleDeps): Lifecycle {
  const { app, loggerHandle } = deps;
  const logger = loggerHandle.logger;
  const exit = deps.exit ?? ((code: number): void => process.exit(code));
  const stdin = deps.stdin ?? process.stdin;
  const timeoutMs = deps.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;

  let shuttingDown = false;
  let settled: Promise<void> = Promise.resolve();

  const shutdown = async (reason: string): Promise<void> => {
    logger.info({ reason }, 'graceful shutdown started');

    const timer = setTimeout(() => {
      logger.fatal({ reason, timeoutMs }, 'graceful shutdown timed out');
      loggerHandle.close();
      exit(1);
    }, timeoutMs);

    let failures = 0;
    try {
      failures += await app.shutdown.runPhase('streams', logger);
      await app.server.close();
      failures += await app.shutdown.runPhase('resources', logger);
      logger.info({ reason, failures }, 'graceful shutdown finished');
    } catch (error) {
      failures += 1;
      logger.error({ err: error, reason }, 'graceful shutdown failed');
    } finally {
      clearTimeout(timer);
      loggerHandle.close();
      exit(failures === 0 ? 0 : 1);
    }
  };

  const start = (reason: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    settled = shutdown(reason);
  };

  if (deps.attachSignals !== false) {
    for (const signal of SIGNALS) {
      process.on(signal, () => {
        start(signal);
      });
    }

    const die = (error: unknown, event: string): void => {
      logger.fatal({ err: error, event }, 'fatal error, exiting for the shell to restart us');
      loggerHandle.close();
      exit(1);
    };
    process.on('uncaughtException', (error) => {
      die(error, 'uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
      die(reason, 'unhandledRejection');
    });
  }

  // Orphan detection (A17): the shell holds our stdin open, so EOF means it is
  // gone. Attached before listen(), and the already-ended case is checked
  // explicitly because 'end' will never fire again for a stream that is done.
  if (deps.config.stdinLifeline) {
    stdin.resume();
    stdin.on('end', () => {
      start('stdin-eof');
    });
    stdin.on('close', () => {
      start('stdin-closed');
    });
    stdin.on('error', () => {
      start('stdin-error');
    });
    if (stdin.readableEnded) {
      start('stdin-already-ended');
    }
  }

  return { start, isShuttingDown: () => shuttingDown, whenSettled: () => settled };
}

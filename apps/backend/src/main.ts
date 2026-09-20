import type { ReadyLine } from '@compintel/contracts';
import type { Logger } from 'pino';

import { buildApp, type App } from './app.js';
import {
  ensureDataDirs,
  loadConfig,
  writeDevConnectionFile,
  type Config,
} from './platform/config.js';
import { createLogger, type LoggerHandle } from './platform/logger.js';
import { StartupError, toStartupFailure } from './platform/startup-error.js';

/** How long a graceful shutdown may take before the process is killed (3.2). */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

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

/**
 * Wires the process into the shutdown paths from ARCHITECTURE.md 3.2 and returns
 * the trigger: stop accepting, run the shutdown hooks in reverse, flush the log,
 * exit 0 - or exit 1 if that takes longer than {@link SHUTDOWN_TIMEOUT_MS}.
 */
function installLifecycle(
  config: Config,
  app: App,
  loggerHandle: LoggerHandle,
): (reason: string) => void {
  const logger = loggerHandle.logger;
  let shuttingDown = false;

  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ reason }, 'graceful shutdown started');

    const timer = setTimeout(() => {
      logger.fatal({ reason, timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'graceful shutdown timed out');
      loggerHandle.close();
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      await app.server.close();
      await app.shutdown.runAll(logger);
      logger.info({ reason }, 'graceful shutdown finished');
    } catch (error) {
      logger.error({ err: error, reason }, 'graceful shutdown failed');
    } finally {
      clearTimeout(timer);
      loggerHandle.close();
      process.exit(0);
    }
  };

  const start = (reason: string): void => {
    void shutdown(reason);
  };

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.on(signal, () => {
      start(signal);
    });
  }

  // Orphan detection (A17): the shell holds our stdin open, so EOF means it died.
  if (config.stdinLifeline) {
    process.stdin.resume();
    process.stdin.on('end', () => {
      start('stdin-eof');
    });
    process.stdin.on('close', () => {
      start('stdin-closed');
    });
    process.stdin.on('error', () => {
      start('stdin-error');
    });
  }

  const die = (error: unknown, event: string): void => {
    logger.fatal({ err: error, event }, 'fatal error, exiting for the shell to restart us');
    loggerHandle.close();
    process.exit(1);
  };
  process.on('uncaughtException', (error) => {
    die(error, 'uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    die(reason, 'unhandledRejection');
  });

  return start;
}

async function main(): Promise<void> {
  let loggerHandle: LoggerHandle | undefined;
  try {
    const config = loadConfig();
    ensureDataDirs(config);

    loggerHandle = createLogger(config);
    const logger = loggerHandle.logger;

    // The route needs the trigger, which needs the built app; one mutable hop
    // breaks the cycle without leaking process concerns into app.ts.
    const lifecycle: { start: (reason: string) => void } = { start: () => undefined };
    const app = buildApp(config, logger, {
      onShutdownRequested: () => {
        lifecycle.start('api');
      },
    });

    await app.server.listen({ host: config.host, port: config.port });
    const port = listeningPort(app);
    lifecycle.start = installLifecycle(config, app, loggerHandle);

    if (config.dev && config.clientSecretGenerated) {
      const file = writeDevConnectionFile(config, port);
      logger.warn({ file }, 'dev mode generated a client secret and wrote it to disk');
    }

    logger.info({ port, dataDir: config.dataDir }, 'backend listening');
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

import type { HealthDatabase, ReadyLine } from '@compintel/contracts';
import type { Logger } from 'pino';

import { buildApp, type App } from './app.js';
import { hasNetworkInterface } from './jobs/online.js';
import { Scheduler } from './jobs/scheduler.js';
import { JobStore } from './jobs/store.js';
import { setArgon2BindingPath } from './modules/auth/argon2-binding.js';
import { AuthRepository } from './modules/auth/repository.js';
import { AuthService } from './modules/auth/service.js';
import { AuditLog } from './platform/audit.js';
import { ensureDataDirs, loadConfig, writeDevConnectionFile } from './platform/config.js';
import { openDatabase } from './platform/db.js';
import { installLifecycle } from './platform/lifecycle.js';
import { acquireDataDirLock } from './platform/lock.js';
import { createLogger, type LoggerHandle } from './platform/logger.js';
import { recordAppMeta, runMigrations } from './platform/migrate.js';
import { resolveResources } from './platform/resources.js';
import { SettingsStore } from './platform/settings.js';
import { ShutdownRegistry } from './platform/shutdown.js';
import { StartupError, toStartupFailure } from './platform/startup-error.js';

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
    const auth = new AuthService({
      repository: new AuthRepository(db),
      settings,
      audit: new AuditLog(db),
    });

    // Constructed before the HTTP layer so its `resources` hook is registered
    // even if the process is asked to stop during startup (R14); started only
    // once we are listening. Jobs themselves are registered by the work packages
    // that own them (scrapes in WP-11, deadlines in WP-20, backups in WP-25).
    const scheduler = new Scheduler({
      store: new JobStore(db),
      logger,
      shutdown,
      isOnline: hasNetworkInterface,
    });

    // The shutdown route needs the trigger, which needs the built app; one
    // mutable hop breaks the cycle without leaking process concerns into app.ts.
    const lifecycle: { start: (reason: string) => void } = { start: () => undefined };
    const app = buildApp(config, logger, {
      shutdown,
      auth: () => auth,
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
        autoLockMinutes: settings.get('auth.autoLockMinutes'),
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

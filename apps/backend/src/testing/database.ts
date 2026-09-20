import path from 'node:path';

import { pino, type Logger } from 'pino';

import { ensureDataDirs, loadConfig, type Config } from '../platform/config.js';
import { openDatabase, type DatabaseHandle } from '../platform/db.js';
import { runMigrations } from '../platform/migrate.js';
import { makeTempDir, removeTempDir } from './temp.js';

/** The real committed migrations folder, so tests exercise the shipped SQL. */
export function migrationsDir(): string {
  return path.resolve(import.meta.dirname, '..', '..', 'migrations');
}

export interface MigratedDatabase {
  readonly config: Config;
  readonly db: DatabaseHandle;
  /** Closes the handle and removes the temporary data directory. */
  close: () => void;
}

/**
 * A fully migrated database in a throwaway data directory under
 * `%LOCALAPPDATA%\CompIntel-dev\test-tmp` (CLAUDE.md: never the repo, never the
 * system temp folder).
 */
export function openMigratedDatabase(logger: Logger = pino({ enabled: false })): MigratedDatabase {
  const dir = makeTempDir('jobs');
  const config = loadConfig({
    argv: ['--data-dir', dir],
    env: { COMPINTEL_CLIENT_SECRET: '0123456789abcdef0123456789abcdef' },
  });
  ensureDataDirs(config);
  const db = openDatabase(config, { logger });
  runMigrations(config, db, { migrationsDir: migrationsDir(), logger });
  return {
    config,
    db,
    close: () => {
      db.close();
      removeTempDir(dir);
    },
  };
}

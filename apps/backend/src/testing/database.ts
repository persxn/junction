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
  /** How many migrations the journal holds. */
  readonly migrations: number;
  /** Closes the handle and removes the temporary data directory. */
  close: () => void;
}

/**
 * A fully migrated database in a throwaway data directory under
 * `%LOCALAPPDATA%\CompIntel-dev\test-tmp` (CLAUDE.md: never the repo, never the
 * system temp folder).
 *
 * The auth tests use the real thing rather than a fake because half of what is
 * under test *is* the database: the CHECK constraints, the unique index on
 * `users.email`, and the two triggers that make `audit_log` append-only.
 */
export function openMigratedDatabase(
  logger: Logger = pino({ enabled: false }),
  prefix = 'jobs',
): MigratedDatabase {
  const dir = makeTempDir(prefix);
  const config = loadConfig({
    argv: ['--data-dir', dir],
    env: { COMPINTEL_CLIENT_SECRET: '0123456789abcdef0123456789abcdef' },
  });
  ensureDataDirs(config);
  const db = openDatabase(config, { logger });
  const applied = runMigrations(config, db, { migrationsDir: migrationsDir(), logger });
  return {
    config,
    db,
    migrations: applied.total,
    close: () => {
      db.close();
      removeTempDir(dir);
    },
  };
}

export type TestDatabase = MigratedDatabase;

/** Shorthand used by the auth and audit tests. */
export function createTestDatabase(prefix = 'auth'): TestDatabase {
  return openMigratedDatabase(pino({ enabled: false }), prefix);
}

/**
 * Argon2id parameters for tests only.
 *
 * The production cost is ~320 ms a hash (§4.12's 250-500 ms band), and a suite
 * that signs in thirty times would spend ten seconds doing nothing else. A PHC
 * string carries its own parameters, so a hash made cheaply here still verifies
 * through exactly the same code path as a real one.
 */
export const CHEAP_ARGON2 = {
  algorithm: 2,
  memoryCost: 8,
  timeCost: 1,
  parallelism: 1,
} as const;

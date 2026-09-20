import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { Database as SqliteDatabase } from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Logger } from 'pino';
import { z } from 'zod';

import { APP_META_LAST_APP_VERSION, APP_META_SCHEMA_CREATED_AT } from '../db/schema/index.js';
import { dataSubdir, type Config } from './config.js';
import type { DatabaseHandle } from './db.js';
import { StartupError } from './startup-error.js';
import { systemClock, type Clock } from './time.js';

/** Drizzle's bookkeeping table; it owns the schema, we only read it. */
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/** How many `pre-migration-*.db` copies are kept (§4.6, finding F4). */
export const PRE_MIGRATION_RETENTION = 5;

const PRE_MIGRATION_PATTERN = /^pre-migration-\d{8}-\d{6}\.db$/;

const Journal = z.object({
  entries: z.array(z.object({ idx: z.int(), when: z.int(), tag: z.string().min(1) })),
});

export interface MigrationResult {
  /** How many migrations this run applied. */
  readonly applied: number;
  /** Rows in `__drizzle_migrations` afterwards — what `/health` reports. */
  readonly total: number;
  /** The safety copy, when one was needed. */
  readonly backupFile: string | undefined;
}

export interface RunMigrationsOptions {
  readonly migrationsDir: string;
  readonly logger: Logger;
  /** Defaults to `<dataDir>\backups-local`. */
  readonly backupDir?: string;
  /** Injected in tests so file names are deterministic. */
  readonly clock?: Clock;
}

function readJournal(migrationsDir: string): z.infer<typeof Journal> {
  const journalFile = path.join(migrationsDir, 'meta', '_journal.json');
  try {
    return Journal.parse(JSON.parse(readFileSync(journalFile, 'utf8')));
  } catch (cause) {
    throw new StartupError(
      'MIGRATION_FAILED',
      `Cannot read the migration journal "${journalFile}": ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/** Newest `created_at` in Drizzle's table, or undefined when it does not exist yet. */
function lastAppliedAt(raw: SqliteDatabase): number | undefined {
  const table = raw
    .prepare(`select name from sqlite_master where type = 'table' and name = ?`)
    .get(MIGRATIONS_TABLE);
  if (table === undefined) {
    return undefined;
  }
  const row = raw.prepare(`select max(created_at) as latest from "${MIGRATIONS_TABLE}"`).get() as
    { latest: number | null } | undefined;
  return row?.latest === null || row?.latest === undefined ? undefined : Number(row.latest);
}

function appliedCount(raw: SqliteDatabase): number {
  const table = raw
    .prepare(`select name from sqlite_master where type = 'table' and name = ?`)
    .get(MIGRATIONS_TABLE);
  if (table === undefined) {
    return 0;
  }
  const row = raw.prepare(`select count(*) as n from "${MIGRATIONS_TABLE}"`).get() as { n: number };
  return row.n;
}

function stamp(date: Date): string {
  const pad = (value: number, width = 2): string => value.toString().padStart(width, '0');
  return (
    `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Deletes all but the newest {@link PRE_MIGRATION_RETENTION} copies. */
export function prunePreMigrationCopies(backupDir: string, keep = PRE_MIGRATION_RETENTION): void {
  let entries: string[];
  try {
    entries = readdirSync(backupDir);
  } catch {
    return;
  }
  const stale = entries
    .filter((name) => PRE_MIGRATION_PATTERN.test(name))
    .sort((a, b) => b.localeCompare(a))
    .slice(keep);
  for (const name of stale) {
    rmSync(path.join(backupDir, name), { force: true });
  }
}

/**
 * Finding F4 / §4.6: a plain local `VACUUM INTO` copy, on the same disk as the
 * database, taken only when an existing database is about to change. It needs no
 * keys and is not the encrypted backup pipeline (§14).
 */
function copyBeforeMigrating(raw: SqliteDatabase, backupDir: string, clock: Clock): string {
  mkdirSync(backupDir, { recursive: true });
  let file = path.join(backupDir, `pre-migration-${stamp(clock.now())}.db`);
  let suffix = 1;
  // VACUUM INTO refuses an existing target, and two migrations inside one second
  // is entirely possible in tests.
  while (existsSync(file)) {
    file = path.join(backupDir, `pre-migration-${stamp(clock.now())}-${suffix.toString()}.db`);
    suffix += 1;
  }
  raw.prepare('VACUUM INTO ?').run(file);
  return file;
}

/**
 * Applies pending migrations, making the §4.6 safety copy first when the
 * database already holds data. Drizzle runs every pending file inside one
 * transaction, so a failure leaves the database exactly as it was; the copy is
 * deliberately kept, because it is the thing a user would restore from.
 */
export function runMigrations(
  config: Config,
  db: DatabaseHandle,
  options: RunMigrationsOptions,
): MigrationResult {
  const clock = options.clock ?? systemClock;
  const backupDir = options.backupDir ?? dataSubdir(config, 'backups-local');
  const journal = readJournal(options.migrationsDir);

  const latest = lastAppliedAt(db.raw);
  const pending = journal.entries.filter((entry) => latest === undefined || latest < entry.when);
  if (pending.length === 0) {
    const total = appliedCount(db.raw);
    options.logger.debug({ total }, 'no pending migrations');
    return { applied: 0, total, backupFile: undefined };
  }

  const isFirstRun = latest === undefined;
  let backupFile: string | undefined;
  if (!isFirstRun) {
    backupFile = copyBeforeMigrating(db.raw, backupDir, clock);
    prunePreMigrationCopies(backupDir);
    options.logger.info(
      { backupFile, pending: pending.map((entry) => entry.tag) },
      'pre-migration copy written',
    );
  }

  try {
    migrate(db.drizzle, { migrationsFolder: options.migrationsDir });
  } catch (cause) {
    throw new StartupError(
      'MIGRATION_FAILED',
      `Migration ${pending[0]?.tag ?? '?'} failed; the database is unchanged` +
        `${backupFile === undefined ? '' : ` and a copy is at "${backupFile}"`}: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  const total = appliedCount(db.raw);
  options.logger.info(
    { applied: pending.length, total, firstRun: isFirstRun },
    'migrations applied',
  );
  return { applied: pending.length, total, backupFile };
}

/**
 * Stamps the database with when it was created and which build last opened it.
 * `schema_created_at` is written once and never touched again, so a restored
 * copy still says when the data started.
 */
export function recordAppMeta(
  config: Config,
  db: DatabaseHandle,
  clock: Clock = systemClock,
): void {
  const at = clock.now();
  const insertOnce = db.raw.prepare(
    `insert into app_meta (key, value, updated_at) values (?, ?, ?) on conflict(key) do nothing`,
  );
  const upsert = db.raw.prepare(
    `insert into app_meta (key, value, updated_at) values (?, ?, ?)
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
  );
  db.raw.transaction(() => {
    insertOnce.run(APP_META_SCHEMA_CREATED_AT, at.toISOString(), at.getTime());
    upsert.run(APP_META_LAST_APP_VERSION, config.appVersion, at.getTime());
  })();
}

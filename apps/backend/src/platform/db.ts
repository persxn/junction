import path from 'node:path';

import Sqlite, { type Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';

import * as schema from '../db/schema/index.js';
import { dataSubdir, type Config } from './config.js';
import { StartupError } from './startup-error.js';
import type { ShutdownRegistry } from './shutdown.js';
import { haversineKmRaw } from '../domain/geo/distance.js';

/** File name of the one database this backend owns (§3.2 packaged layout). */
export const DATABASE_FILE = 'app.db';

/**
 * Ruling R16, in the order they must be issued: `journal_mode` has to be set
 * before anything writes, and `foreign_keys` is per-connection in SQLite, so it
 * is not a schema property and must be set on every open.
 */
export const REQUIRED_PRAGMAS = [
  ['journal_mode', 'WAL'],
  ['synchronous', 'NORMAL'],
  ['foreign_keys', 'ON'],
  ['busy_timeout', '5000'],
  // Negative means KiB rather than pages: 32 MB, the cap from §4.5.
  ['cache_size', '-32000'],
  ['temp_store', 'MEMORY'],
] as const;

/** What the PRAGMAs read back as, for the startup assertion and the tests. */
export const EXPECTED_PRAGMA_VALUES: Readonly<Record<string, string | number>> = {
  journal_mode: 'wal',
  synchronous: 1,
  foreign_keys: 1,
  busy_timeout: 5000,
  cache_size: -32000,
  temp_store: 2,
};

export interface DatabaseHandle {
  readonly drizzle: BetterSQLite3Database<typeof schema>;
  readonly raw: SqliteDatabase;
  readonly file: string;
  /** True while the handle is open and answering, for `GET /health`. */
  isHealthy(): boolean;
  /** Checkpoints, optimizes and closes. Idempotent; also the shutdown hook. */
  close(): void;
}

export interface OpenDatabaseOptions {
  readonly logger: Logger;
  /** The R16 shutdown hook is registered here, in the `resources` phase. */
  readonly shutdown?: ShutdownRegistry;
  /** Defaults to `<dataDir>\data\app.db`. */
  readonly file?: string;
  /** Explicit addon path for the bundle (ruling R17). */
  readonly nativeBinding?: string | undefined;
  /** Test seam: returns the rows `PRAGMA quick_check` would return. */
  readonly integrityCheck?: (raw: SqliteDatabase) => readonly string[];
}

export function databaseFile(config: Config): string {
  return path.join(dataSubdir(config, 'data'), DATABASE_FILE);
}

/** `PRAGMA quick_check` returns a single row `ok` on a healthy file. */
export function quickCheck(raw: SqliteDatabase): readonly string[] {
  const rows = raw.pragma('quick_check') as { quick_check: string }[];
  return rows.map((row) => row.quick_check);
}

function applyPragmas(raw: SqliteDatabase): void {
  for (const [name, value] of REQUIRED_PRAGMAS) {
    raw.pragma(`${name} = ${value}`);
  }
}

/** Reads every R16 pragma back, so a silently ignored setting cannot pass. */
export function readPragmas(raw: SqliteDatabase): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name] of REQUIRED_PRAGMAS) {
    const rows = raw.pragma(name) as Record<string, string | number>[];
    const first = rows[0];
    out[name] = first === undefined ? '' : (Object.values(first)[0] ?? '');
  }
  return out;
}

/**
 * SQL functions this connection provides, registered before anything queries.
 *
 * **One haversine (ruling R56).** `haversine_km` delegates to
 * `domain/geo/distance.ts`, which is also what every in-process calculation
 * calls. §8.2 filters candidates with an indexed bounding box and then measures
 * exactly, and WP-15a will sort on the result — if the SQL and the JavaScript
 * were separate implementations they would eventually disagree by a rounding
 * rule, and the symptom would be an event 49 km away in the list and 51 km away
 * on its own page. Nobody finds that bug.
 *
 * `deterministic` lets SQLite use it in an index or a partial index later;
 * `safeIntegers` is left off because coordinates are REAL.
 */
function registerSqlFunctions(raw: SqliteDatabase): void {
  raw.function(
    'haversine_km',
    { deterministic: true, varargs: false },
    (lat1: unknown, lon1: unknown, lat2: unknown, lon2: unknown): number | null => {
      // Any NULL coordinate means "we do not know where this is", and a
      // distance from an unknown point is not 0 — it is unknown (§6.1).
      if (
        typeof lat1 !== 'number' ||
        typeof lon1 !== 'number' ||
        typeof lat2 !== 'number' ||
        typeof lon2 !== 'number'
      ) {
        return null;
      }
      return haversineKmRaw(lat1, lon1, lat2, lon2);
    },
  );
}

/**
 * Opens the single database this process owns and proves it is usable before the
 * HTTP server ever starts: the PRAGMAs from ruling R16 are applied and read back,
 * then `PRAGMA quick_check` runs. A corrupt file fails the start with
 * `DB_CORRUPT` rather than serving half a dataset.
 */
export function openDatabase(config: Config, options: OpenDatabaseOptions): DatabaseHandle {
  const file = options.file ?? databaseFile(config);
  const nativeBinding = options.nativeBinding ?? config.nativeBinding;

  let raw: SqliteDatabase;
  try {
    raw = new Sqlite(file, nativeBinding === undefined ? {} : { nativeBinding });
  } catch (cause) {
    throw new StartupError(
      'DB_OPEN_FAILED',
      `Cannot open the database "${file}": ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  try {
    applyPragmas(raw);
    registerSqlFunctions(raw);
    const problems = (options.integrityCheck ?? quickCheck)(raw).filter(
      (row) => row.toLowerCase() !== 'ok',
    );
    if (problems.length > 0) {
      throw new StartupError(
        'DB_CORRUPT',
        `PRAGMA quick_check reported ${problems.length.toString()} problem(s) in "${file}": ` +
          problems.slice(0, 3).join('; '),
      );
    }
  } catch (error) {
    raw.close();
    if (error instanceof StartupError) {
      throw error;
    }
    // better-sqlite3 opens lazily, so "file is not a database" surfaces on the
    // first PRAGMA rather than in the constructor above.
    throw new StartupError(
      'DB_OPEN_FAILED',
      `Cannot use the database "${file}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  options.logger.info(
    { file, pragmas: readPragmas(raw), sqlite: raw.prepare('select sqlite_version() as v').get() },
    'database opened',
  );

  let closed = false;
  const close = (): void => {
    if (closed || !raw.open) {
      return;
    }
    closed = true;
    try {
      // Fold the WAL back into the main file so a copy of app.db alone is a
      // complete database, then let SQLite refresh its query-planner stats.
      raw.pragma('wal_checkpoint(TRUNCATE)');
      raw.pragma('optimize');
    } catch (error) {
      options.logger.error({ err: error }, 'database checkpoint failed; closing anyway');
    } finally {
      raw.close();
    }
  };

  options.shutdown?.register('resources', 'database', close);

  return {
    drizzle: drizzle(raw, { schema }),
    raw,
    file,
    isHealthy: () => raw.open,
    close,
  };
}

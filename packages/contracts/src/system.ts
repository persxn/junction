import { z } from 'zod';

/** Database section of the health body (WP-04b). */
export const HealthDatabase = z.object({
  /** The handle is open and answering; false means the API cannot serve data. */
  ok: z.boolean(),
  /** How many migrations this database has on record. */
  migrationsApplied: z.int().min(0),
});
export type HealthDatabase = z.infer<typeof HealthDatabase>;

/** Body of `GET /api/v1/health`. Needs only the client secret (ADR-0017). */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  /** Version of the backend build. */
  appVersion: z.string().min(1),
  /** Version of the REST contract served under `/api/v1`. */
  apiVersion: z.string().min(1),
  /** When this backend process finished starting, ISO 8601 with an offset. */
  startedAt: z.iso.datetime({ offset: true }),
  /** Whole seconds since `startedAt`. */
  uptimeSec: z.int().min(0),
  database: HealthDatabase,
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Why a backend process could not start (the `ready:false` line on stdout). */
export const STARTUP_ERROR_CODES = [
  'CONFIG_INVALID',
  'DATA_DIR_UNUSABLE',
  /** Another backend already owns this data directory (ruling R15). */
  'DATA_DIR_LOCKED',
  /** The database file could not be opened (ruling R16). */
  'DB_OPEN_FAILED',
  /** `PRAGMA quick_check` failed; the file must be restored from a backup (R16). */
  'DB_CORRUPT',
  /** A pending migration failed; the database is unchanged (§4.6). */
  'MIGRATION_FAILED',
  'LISTEN_FAILED',
  'STARTUP_FAILED',
] as const;
export const StartupErrorCode = z.enum(STARTUP_ERROR_CODES);
export type StartupErrorCode = z.infer<typeof StartupErrorCode>;

/** The backend started and is listening (ARCHITECTURE.md §3.2). */
export const ReadyLineOk = z.object({
  ready: z.literal(true),
  port: z.int().min(1).max(65535),
  pid: z.int().min(1),
  appVersion: z.string().min(1),
  apiVersion: z.string().min(1),
});
export type ReadyLineOk = z.infer<typeof ReadyLineOk>;

/** The backend gave up during startup; it exits 1 right after writing this. */
export const ReadyLineFailed = z.object({
  ready: z.literal(false),
  error: z.object({
    code: StartupErrorCode,
    message: z.string().min(1),
  }),
});
export type ReadyLineFailed = z.infer<typeof ReadyLineFailed>;

/**
 * The single JSON line the backend writes to stdout, and the only thing that ever
 * goes there (ruling R7). The shell reads exactly one line and then stops parsing.
 */
export const ReadyLine = z.discriminatedUnion('ready', [ReadyLineOk, ReadyLineFailed]);
export type ReadyLine = z.infer<typeof ReadyLine>;

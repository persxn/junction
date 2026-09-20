import { z } from 'zod';

/**
 * Vocabulary of the DB-backed job runner (ARCHITECTURE.md §4.9, ADR-0008). The
 * runner itself lives in the backend; these are the names the database rows, the
 * log lines and any later admin API all have to agree on.
 */

/**
 * Concurrency class of a job. §4.9 caps the global limits per class - 2
 * concurrent scrapes, 1 LLM job - so every job has to declare which pool it
 * competes for. `GENERAL` is everything cheap and local (deadline evaluation,
 * cleanup, health snapshots).
 */
export const JOB_KINDS = ['SCRAPE', 'LLM', 'GENERAL'] as const;
export const JobKind = z.enum(JOB_KINDS);
export type JobKind = z.infer<typeof JobKind>;

/**
 * Why a run started. The values are deliberately the same three as
 * `scrape_runs.trigger` (§6.2), because a scheduled scrape writes both rows.
 */
export const JOB_TRIGGERS = ['SCHEDULE', 'MANUAL', 'STARTUP_CATCHUP'] as const;
export const JobTrigger = z.enum(JOB_TRIGGERS);
export type JobTrigger = z.infer<typeof JobTrigger>;

/**
 * How a run ended. `SUCCESS`, `PARTIAL`, `FAILED`, `SKIPPED_OFFLINE` and
 * `SKIPPED_BACKOFF` match `scrape_runs.outcome` (§6.2); the runner adds two of
 * its own:
 *
 * - `ABORTED` - shutdown cut the run short; not a failure, so no backoff.
 * - `CRASHED` - a `running_since` lease was found stale, i.e. the process died
 *   mid-run. Counted as a failure so a job that kills the backend backs off
 *   instead of crash-looping on every restart.
 */
export const JOB_OUTCOMES = [
  'SUCCESS',
  'PARTIAL',
  'FAILED',
  'SKIPPED_OFFLINE',
  'SKIPPED_BACKOFF',
  'ABORTED',
  'CRASHED',
] as const;
export const JobOutcome = z.enum(JOB_OUTCOMES);
export type JobOutcome = z.infer<typeof JobOutcome>;

/** Outcomes that count as a failure: they increment `consecutive_failures`. */
export const FAILING_JOB_OUTCOMES: readonly JobOutcome[] = ['FAILED', 'CRASHED'];

/** Outcomes that stamp `last_success_at`. `PARTIAL` deliberately does not. */
export const SUCCEEDING_JOB_OUTCOMES: readonly JobOutcome[] = ['SUCCESS'];

/**
 * One `job_state` row (§6.2) as the rest of the app sees it: timestamps are Unix
 * milliseconds UTC (§6.1) and everything optional is `null` rather than absent,
 * because that is what SQLite hands back.
 */
export const JobSnapshot = z.object({
  jobKey: z.string().min(1),
  kind: JobKind,
  lastRunAt: z.int().nullable(),
  lastSuccessAt: z.int().nullable(),
  nextDueAt: z.int(),
  runningSince: z.int().nullable(),
  consecutiveFailures: z.int().min(0),
  backoffUntil: z.int().nullable(),
  lastOutcome: JobOutcome.nullable(),
  lastDurationMs: z.int().min(0).nullable(),
  lastErrorMessage: z.string().nullable(),
});
export type JobSnapshot = z.infer<typeof JobSnapshot>;

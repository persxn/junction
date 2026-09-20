import { JOB_KINDS, JOB_OUTCOMES, type JobKind, type JobOutcome } from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** `"A", "B"` - CHECK lists are written from the contracts enums (§6.1). */
function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/**
 * The scheduler's whole memory (§6.2 `job_state`, §4.9, ADR-0008). There is one
 * row per registered job, keyed by the job key (`scrape:ctftime`,
 * `deadline-evaluator`, ...) rather than a UUID: a job is a singleton, and the
 * key is what the code, the logs and the admin screens all use.
 *
 * `next_due_at` is the only thing that decides whether a job runs, which is what
 * makes catch-up after a restart or a sleep automatic and drift-free: the clock
 * is read, not counted. `running_since` is the single-flight lease - it survives
 * a crash, so the next start can tell a dead run from a live one.
 *
 * The last four columns are beyond the §6.2 key-column list; they exist so a run
 * can be explained ("why is this source red?") without a second table. A full
 * per-run history for scraping is `scrape_runs`, which arrives with WP-11.
 */
export const jobState = sqliteTable(
  'job_state',
  {
    jobKey: text('job_key').primaryKey(),
    /** Concurrency class; see `JOB_KINDS`. */
    kind: text('kind').$type<JobKind>().notNull().default('GENERAL'),
    lastRunAt: integer('last_run_at'),
    lastSuccessAt: integer('last_success_at'),
    nextDueAt: integer('next_due_at').notNull(),
    /** Set while a run holds the job; NULL means free. */
    runningSince: integer('running_since'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** While in the future the job is not due, however old `next_due_at` is. */
    backoffUntil: integer('backoff_until'),
    lastOutcome: text('last_outcome').$type<JobOutcome>(),
    lastDurationMs: integer('last_duration_ms'),
    lastErrorMessage: text('last_error_message'),
  },
  (table) => [
    // The tick's only query: "everything due now".
    index('job_state_next_due_at_idx').on(table.nextDueAt),
    check('job_state_kind_check', sql.raw(`"kind" in (${quoted(JOB_KINDS)})`)),
    check(
      'job_state_last_outcome_check',
      sql.raw(`"last_outcome" is null or "last_outcome" in (${quoted(JOB_OUTCOMES)})`),
    ),
    check('job_state_consecutive_failures_check', sql.raw(`"consecutive_failures" >= 0`)),
  ],
);

export type JobStateRow = typeof jobState.$inferSelect;

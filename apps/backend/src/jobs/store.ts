import type { JobSnapshot } from '@compintel/contracts';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';

import { jobState, type JobStateRow } from '../db/schema/index.js';
import type { DatabaseHandle } from '../platform/db.js';
import type { JobStatePatch } from './outcome.js';
import type { RegisteredJob } from './types.js';

/**
 * Everything the runner does to `job_state`, in one place. The claim is a
 * conditional UPDATE rather than a read-then-write, so single-flight holds even
 * if two ticks ever overlap - and the same row is what a crashed process leaves
 * behind for the next start to reclaim.
 */
export class JobStore {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  get #drizzle(): DatabaseHandle['drizzle'] {
    return this.#db.drizzle;
  }

  /**
   * Creates the row for a job the first time it is ever registered and returns
   * the current one. An existing row is kept untouched apart from `kind`, which
   * follows the code: a job's concurrency class is a property of this build, not
   * of the data.
   */
  ensure(job: RegisteredJob, firstDueAt: number): JobStateRow {
    this.#drizzle
      .insert(jobState)
      .values({ jobKey: job.key, kind: job.kind, nextDueAt: firstDueAt })
      .onConflictDoNothing()
      .run();
    this.#drizzle
      .update(jobState)
      .set({ kind: job.kind })
      .where(and(eq(jobState.jobKey, job.key), sql`${jobState.kind} <> ${job.kind}`))
      .run();
    const row = this.read(job.key);
    if (row === undefined) {
      throw new Error(`job_state row for "${job.key}" vanished right after it was written.`);
    }
    return row;
  }

  read(key: string): JobStateRow | undefined {
    return this.#drizzle.select().from(jobState).where(eq(jobState.jobKey, key)).get();
  }

  /** Every row, oldest due date first - the order the admin screens want. */
  all(): readonly JobStateRow[] {
    return this.#drizzle.select().from(jobState).orderBy(asc(jobState.nextDueAt)).all();
  }

  /**
   * Rows that want to run now: due, not backing off, not held by a run. Ordered
   * by due date so the most overdue job goes first when a concurrency limit
   * means not everything can start in this tick.
   */
  due(nowMs: number): readonly JobStateRow[] {
    return this.#drizzle
      .select()
      .from(jobState)
      .where(
        and(
          isNull(jobState.runningSince),
          lte(jobState.nextDueAt, nowMs),
          or(isNull(jobState.backoffUntil), lte(jobState.backoffUntil, nowMs)),
        ),
      )
      .orderBy(asc(jobState.nextDueAt))
      .all();
  }

  /** Rows a run is holding, which after a crash is exactly the stale leases. */
  running(): readonly JobStateRow[] {
    return this.#drizzle
      .select()
      .from(jobState)
      .where(sql`${jobState.runningSince} is not null`)
      .all();
  }

  /**
   * Takes the single-flight lease. False means somebody else holds it, and the
   * caller must not run the job.
   */
  claim(key: string, nowMs: number): boolean {
    const result = this.#drizzle
      .update(jobState)
      .set({ runningSince: nowMs })
      .where(and(eq(jobState.jobKey, key), isNull(jobState.runningSince)))
      .run();
    return result.changes === 1;
  }

  /** Writes a finished run's bookkeeping and releases the lease. */
  finish(key: string, patch: JobStatePatch): void {
    this.#drizzle
      .update(jobState)
      .set({ ...patch, runningSince: null })
      .where(eq(jobState.jobKey, key))
      .run();
  }

  /** Moves a job's due date, used by a forced manual trigger. */
  setNextDueAt(key: string, nextDueAt: number): void {
    this.#drizzle.update(jobState).set({ nextDueAt }).where(eq(jobState.jobKey, key)).run();
  }

  /** Due at `atMs`, with no backoff and no failure streak (`Scheduler.makeDueNow`). */
  makeDue(key: string, atMs: number): void {
    this.#drizzle
      .update(jobState)
      .set({ nextDueAt: atMs, backoffUntil: null, consecutiveFailures: 0 })
      .where(eq(jobState.jobKey, key))
      .run();
  }

  /** Clears the backoff, so a forced manual run is not refused by `isDue`. */
  clearBackoff(key: string): void {
    this.#drizzle
      .update(jobState)
      .set({ backoffUntil: null, consecutiveFailures: 0 })
      .where(eq(jobState.jobKey, key))
      .run();
  }

  /** The serializable view of one row (`JobSnapshot` in contracts). */
  static toSnapshot(row: JobStateRow): JobSnapshot {
    return {
      jobKey: row.jobKey,
      kind: row.kind,
      lastRunAt: row.lastRunAt,
      lastSuccessAt: row.lastSuccessAt,
      nextDueAt: row.nextDueAt,
      runningSince: row.runningSince,
      consecutiveFailures: row.consecutiveFailures,
      backoffUntil: row.backoffUntil,
      lastOutcome: row.lastOutcome,
      lastDurationMs: row.lastDurationMs,
      lastErrorMessage: row.lastErrorMessage,
    };
  }
}

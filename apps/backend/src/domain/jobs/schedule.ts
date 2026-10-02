import type { JobKind, JobOutcome } from '@compintel/contracts';

import { applyJitter } from '../scheduling.js';

/**
 * The two scheduling decisions that need a job definition (§4.9, R22). The
 * arithmetic and the predicates they build on are in `domain/scheduling.ts`.
 *
 * They lived in `jobs/schedule.ts` until pre-M2b, typed against the Drizzle
 * row; here they are typed against the shape below instead, so the job-state
 * shape is defined by the domain and `db/schema/job-state.ts` conforms to it
 * (a type test in `jobs/schedule-shape.test.ts` keeps the two identical).
 */

/** One `job_state` row, as the scheduling decisions read it (§6.2). */
export interface JobStateShape {
  readonly jobKey: string;
  readonly kind: JobKind;
  readonly lastRunAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly nextDueAt: number;
  readonly runningSince: number | null;
  readonly consecutiveFailures: number;
  readonly backoffUntil: number | null;
  readonly lastOutcome: JobOutcome | null;
  readonly lastDurationMs: number | null;
  readonly lastErrorMessage: string | null;
}

/** What of a registered job the scheduling decisions read. */
export interface SchedulableJob {
  readonly key: string;
  readonly kind: JobKind;
  readonly jitterRatio: number;
  readonly definition: {
    readonly intervalMs?: number;
    readonly nextDueAt?: (from: Date, previous: JobStateShape) => number;
    readonly firstRun?: 'immediate' | 'after-interval';
  };
}

/**
 * When a job should next run after a completed attempt. A fixed-interval job
 * gets `interval ± jitter` from now; a wall-clock job (`backup:daily`) is asked.
 * `retryAfterMs` from the job itself wins, because only the job knows it was
 * told to come back later.
 */
export function nextDueAfterRun(
  job: SchedulableJob,
  previous: JobStateShape,
  at: Date,
  random: () => number,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) {
    return at.getTime() + Math.round(retryAfterMs);
  }
  if (job.definition.nextDueAt !== undefined) {
    return job.definition.nextDueAt(at, previous);
  }
  const interval = job.definition.intervalMs ?? 0;
  return at.getTime() + applyJitter(interval, job.jitterRatio, random);
}

/**
 * When a newly registered job first becomes due. A fresh install wants its jobs
 * to run at once (`immediate`, the default) rather than 15 minutes after the
 * setup wizard closed.
 */
export function firstDueAt(job: SchedulableJob, at: Date, random: () => number): number {
  if (job.definition.firstRun !== 'after-interval') {
    return at.getTime();
  }
  if (job.definition.nextDueAt !== undefined) {
    return job.definition.nextDueAt(at, {
      jobKey: job.key,
      kind: job.kind,
      lastRunAt: null,
      lastSuccessAt: null,
      nextDueAt: at.getTime(),
      runningSince: null,
      consecutiveFailures: 0,
      backoffUntil: null,
      lastOutcome: null,
      lastDurationMs: null,
      lastErrorMessage: null,
    });
  }
  return at.getTime() + applyJitter(job.definition.intervalMs ?? 0, job.jitterRatio, random);
}

import type { JobStateRow } from '../db/schema/index.js';
import { applyJitter } from '../domain/scheduling.js';
import type { RegisteredJob } from './types.js';

/**
 * The two scheduling decisions that need a registered job definition. The
 * arithmetic and the predicates they build on are pure and live in
 * `domain/scheduling.ts`.
 */

/**
 * When a job should next run after a completed attempt. A fixed-interval job
 * gets `interval ± jitter` from now; a wall-clock job (`backup:daily`) is asked.
 * `retryAfterMs` from the job itself wins, because only the job knows it was
 * told to come back later.
 */
export function nextDueAfterRun(
  job: RegisteredJob,
  previous: JobStateRow,
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
export function firstDueAt(job: RegisteredJob, at: Date, random: () => number): number {
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

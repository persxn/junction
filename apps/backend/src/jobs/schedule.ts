import type { JobStateRow } from '../db/schema/index.js';
import type { RegisteredJob } from './types.js';

/**
 * The scheduling arithmetic, kept pure so it can be tested without a database,
 * a clock or a timer. Everything here works in Unix milliseconds (§6.1).
 */

/**
 * Spreads a delay by up to ±`ratio`. `random` returns [0, 1) like `Math.random`,
 * and is injected so tests can pin the result. The delay never goes below zero
 * and never below one millisecond, so a jittered interval cannot become "now
 * again" and spin.
 */
export function applyJitter(delayMs: number, ratio: number, random: () => number): number {
  if (ratio <= 0 || delayMs <= 0) {
    return Math.max(0, Math.round(delayMs));
  }
  const spread = delayMs * ratio;
  const offset = (random() * 2 - 1) * spread;
  return Math.max(1, Math.round(delayMs + offset));
}

/**
 * Exponential backoff: base, 2 × base, 4 × base … capped at `maxMs`
 * (§7.2: 15 → 30 → 60 min … max 12 h). `failures` is the number of consecutive
 * failures *including* the one that just happened, so the first retry waits
 * exactly `baseMs`.
 */
export function backoffDelayMs(failures: number, baseMs: number, maxMs: number): number {
  if (failures <= 0) {
    return 0;
  }
  // 2 ** 1024 is Infinity, and Math.min keeps that honest, but clamping the
  // exponent first avoids relying on that.
  const steps = Math.min(failures - 1, 40);
  return Math.min(maxMs, baseMs * 2 ** steps);
}

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

/**
 * A job is due when its next due time has arrived, it is not backing off, and no
 * run holds it. Both `next_due_at` and `backoff_until` are checked because a
 * failure pushes the due time out *and* records the backoff, and a manual
 * `trigger()` may move the due time back without clearing the backoff.
 */
export function isDue(row: JobStateRow, nowMs: number): boolean {
  if (row.runningSince !== null) {
    return false;
  }
  if (row.backoffUntil !== null && row.backoffUntil > nowMs) {
    return false;
  }
  return row.nextDueAt <= nowMs;
}

/** True when a `running_since` lease is older than the job's allowance. */
export function isLeaseExpired(row: JobStateRow, leaseMs: number, nowMs: number): boolean {
  return row.runningSince !== null && row.runningSince + leaseMs <= nowMs;
}

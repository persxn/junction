/**
 * The job runner's arithmetic and predicates (§4.9, §7.2), kept pure so they can
 * be tested without a database, a clock or a timer. Everything works in Unix
 * milliseconds (§6.1).
 *
 * The state these read is described here rather than imported from `db/schema`:
 * the maths needs four numbers, not a table row, and stating that keeps the
 * dependency pointing the right way. A `JobStateRow` satisfies it structurally,
 * so the repositories hand their rows straight in.
 */

/** What the scheduling decisions need to know about a job's stored state. */
export interface JobSchedulingState {
  /** When the job next becomes eligible to run. */
  readonly nextDueAt: number;
  /** When the current run claimed its lease, or null when nothing holds it. */
  readonly runningSince: number | null;
  /** Set by a failure; the job stays ineligible until it passes. */
  readonly backoffUntil: number | null;
}

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
 * A job is due when its next due time has arrived, it is not backing off, and no
 * run holds it. Both `next_due_at` and `backoff_until` are checked because a
 * failure pushes the due time out *and* records the backoff, and a manual
 * `trigger()` may move the due time back without clearing the backoff.
 */
export function isDue(state: JobSchedulingState, atMs: number): boolean {
  if (state.runningSince !== null) {
    return false;
  }
  if (state.backoffUntil !== null && state.backoffUntil > atMs) {
    return false;
  }
  return state.nextDueAt <= atMs;
}

/** True when a `running_since` lease is older than the job's allowance. */
export function isLeaseExpired(state: JobSchedulingState, leaseMs: number, atMs: number): boolean {
  return state.runningSince !== null && state.runningSince + leaseMs <= atMs;
}

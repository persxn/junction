/**
 * The per-account lockout ladder (ruling R34, §4.12).
 *
 * Pure arithmetic over the failure counter, which is the point: the ladder is
 * *derived* rather than stored, so `users` needs no extra column and the rule
 * can be read, tested and changed in one place. The in-memory process-wide
 * limiter that sits beside it in the auth module is a different limit stopping a
 * different attack, and it holds state, so it stays there.
 */

/** Consecutive failures between one lockout and the next. */
export const LOCKOUT_THRESHOLD = 5;

/** Minutes locked for the 1st, 2nd, 3rd… lockout; the last value is the cap. */
export const LOCKOUT_LADDER_MINUTES = [5, 10, 20, 40, 60] as const;

/**
 * How long to lock after this many consecutive failures, or `undefined` when
 * this failure is not a threshold: the 5th failure locks for 5 minutes, the 10th
 * for 10, the 15th for 20, the 20th for 40, and every one after that for an hour.
 */
export function lockoutMinutesFor(failedLoginCount: number): number | undefined {
  if (failedLoginCount <= 0 || failedLoginCount % LOCKOUT_THRESHOLD !== 0) {
    return undefined;
  }
  const step = failedLoginCount / LOCKOUT_THRESHOLD - 1;
  return LOCKOUT_LADDER_MINUTES[Math.min(step, LOCKOUT_LADDER_MINUTES.length - 1)];
}

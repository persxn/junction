/**
 * Login throttling (ruling R34, §4.12, §10.3).
 *
 * Two independent limits, because they stop different things. The per-account
 * lockout stops someone grinding one professor's password; the process-wide
 * ceiling stops someone spraying one password across every account, which no
 * per-account counter would ever notice.
 */

/** Consecutive failures between one lockout and the next. */
export const LOCKOUT_THRESHOLD = 5;

/** Minutes locked for the 1st, 2nd, 3rd… lockout; the last value is the cap. */
export const LOCKOUT_LADDER_MINUTES = [5, 10, 20, 40, 60] as const;

/**
 * How long to lock after this many consecutive failures, or `undefined` when
 * this failure is not a threshold. The ladder is derived from the counter rather
 * than stored, so `users` needs no extra column: the 5th failure locks for 5
 * minutes, the 10th for 10, the 15th for 20, the 20th for 40, and every one
 * after that for an hour.
 */
export function lockoutMinutesFor(failedLoginCount: number): number | undefined {
  if (failedLoginCount <= 0 || failedLoginCount % LOCKOUT_THRESHOLD !== 0) {
    return undefined;
  }
  const step = failedLoginCount / LOCKOUT_THRESHOLD - 1;
  return LOCKOUT_LADDER_MINUTES[Math.min(step, LOCKOUT_LADDER_MINUTES.length - 1)];
}

/** Process-wide ceiling from R34. */
export const LOGIN_RATE_LIMIT = 10;
export const LOGIN_RATE_WINDOW_MS = 60_000;

export interface LoginRateLimiterOptions {
  readonly limit?: number;
  readonly windowMs?: number;
  readonly now?: () => number;
}

/**
 * A sliding window over attempt timestamps. It is deliberately in memory and
 * per-process: a restart clears it, which is fine — a restart is not something
 * an attacker on the loopback interface can cause, and the per-account lockout
 * in the database is the limit that has to survive one.
 */
export class LoginRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  #attempts: number[] = [];

  constructor(options: LoginRateLimiterOptions = {}) {
    this.#limit = options.limit ?? LOGIN_RATE_LIMIT;
    this.#windowMs = options.windowMs ?? LOGIN_RATE_WINDOW_MS;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Records an attempt and says whether it is allowed. Refused attempts are not
   * recorded, so a client hammering the door cannot extend its own timeout.
   */
  tryAcquire(): boolean {
    const now = this.#now();
    this.#attempts = this.#attempts.filter((at) => now - at < this.#windowMs);
    if (this.#attempts.length >= this.#limit) {
      return false;
    }
    this.#attempts.push(now);
    return true;
  }

  /** Attempts still counted in the current window; for tests and diagnostics. */
  used(): number {
    const now = this.#now();
    return this.#attempts.filter((at) => now - at < this.#windowMs).length;
  }
}

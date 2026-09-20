import { nowMs, systemClock, type Clock } from '../../platform/time.js';

/**
 * The process-wide login limiter (ruling R34, §4.12, §10.3).
 *
 * Two independent limits stop different things. The per-account lockout stops
 * someone grinding one professor's password, and because it is pure arithmetic
 * over a counter it lives in `domain/lockout.ts`. This is the other one: a
 * process-wide ceiling that stops someone spraying one password across every
 * account, which no per-account counter would ever notice. It holds state, so
 * it stays here.
 */

/** Process-wide ceiling from R34. */
export const LOGIN_RATE_LIMIT = 10;
export const LOGIN_RATE_WINDOW_MS = 60_000;

export interface LoginRateLimiterOptions {
  readonly limit?: number;
  readonly windowMs?: number;
  readonly clock?: Clock;
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
  readonly #clock: Clock;
  #attempts: number[] = [];

  constructor(options: LoginRateLimiterOptions = {}) {
    this.#limit = options.limit ?? LOGIN_RATE_LIMIT;
    this.#windowMs = options.windowMs ?? LOGIN_RATE_WINDOW_MS;
    this.#clock = options.clock ?? systemClock;
  }

  /** Milliseconds since the epoch, the shape every timestamp column wants. */
  get #nowMs(): number {
    return nowMs(this.#clock);
  }

  /**
   * Records an attempt and says whether it is allowed. Refused attempts are not
   * recorded, so a client hammering the door cannot extend its own timeout.
   */
  tryAcquire(): boolean {
    const now = this.#nowMs;
    this.#attempts = this.#attempts.filter((at) => now - at < this.#windowMs);
    if (this.#attempts.length >= this.#limit) {
      return false;
    }
    this.#attempts.push(now);
    return true;
  }

  /** Attempts still counted in the current window; for tests and diagnostics. */
  used(): number {
    const now = this.#nowMs;
    return this.#attempts.filter((at) => now - at < this.#windowMs).length;
  }
}

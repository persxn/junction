import { describe, expect, it } from 'vitest';

import {
  applyJitter,
  backoffDelayMs,
  isDue,
  isLeaseExpired,
  type JobSchedulingState,
} from './scheduling.js';

const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const MINUTE = 60_000;
const BACKOFF_BASE_MS = 15 * MINUTE;
const BACKOFF_MAX_MS = 12 * 3_600_000;

/** `Math.random` is injected everywhere, so a fixed value pins the jitter. */
const mid = (): number => 0.5;
const low = (): number => 0;
const high = (): number => 0.999_999;

/**
 * The four fields the maths reads. A `JobStateRow` satisfies this structurally,
 * which is the whole point of stating the shape here rather than importing it.
 */
function state(overrides: Partial<JobSchedulingState> = {}): JobSchedulingState {
  return { nextDueAt: T0, runningSince: null, backoffUntil: null, ...overrides };
}

describe('applyJitter', () => {
  it('is a no-op in the middle of the range', () => {
    expect(applyJitter(10 * MINUTE, 0.1, mid)).toBe(10 * MINUTE);
  });

  it('subtracts at most the ratio and adds at most the ratio', () => {
    expect(applyJitter(10 * MINUTE, 0.1, low)).toBe(9 * MINUTE);
    expect(applyJitter(10 * MINUTE, 0.1, high)).toBeCloseTo(11 * MINUTE, -1);
  });

  it('never returns zero, so a jittered interval cannot spin', () => {
    expect(applyJitter(1, 0.5, low)).toBe(1);
  });

  it('passes the delay through when jitter is switched off', () => {
    expect(applyJitter(1234, 0, low)).toBe(1234);
  });
});

describe('backoffDelayMs', () => {
  it('follows the 15 -> 30 -> 60 min ladder from §7.2', () => {
    expect(backoffDelayMs(1, BACKOFF_BASE_MS, BACKOFF_MAX_MS)).toBe(15 * MINUTE);
    expect(backoffDelayMs(2, BACKOFF_BASE_MS, BACKOFF_MAX_MS)).toBe(30 * MINUTE);
    expect(backoffDelayMs(3, BACKOFF_BASE_MS, BACKOFF_MAX_MS)).toBe(60 * MINUTE);
    expect(backoffDelayMs(4, BACKOFF_BASE_MS, BACKOFF_MAX_MS)).toBe(120 * MINUTE);
  });

  it('caps at 12 hours however long the streak is', () => {
    expect(backoffDelayMs(20, BACKOFF_BASE_MS, BACKOFF_MAX_MS)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelayMs(5_000, BACKOFF_BASE_MS, BACKOFF_MAX_MS)).toBe(BACKOFF_MAX_MS);
  });

  it('is zero without a failure', () => {
    expect(backoffDelayMs(0, BACKOFF_BASE_MS, BACKOFF_MAX_MS)).toBe(0);
  });
});

describe('isDue', () => {
  it('is true once the due time has arrived', () => {
    expect(isDue(state({ nextDueAt: T0 }), T0)).toBe(true);
    expect(isDue(state({ nextDueAt: T0 + 1 }), T0)).toBe(false);
  });

  it('is true for a long-overdue job, which is what catch-up depends on', () => {
    expect(isDue(state({ nextDueAt: T0 - 8 * 60 * MINUTE }), T0)).toBe(true);
  });

  it('is false while a run holds the job', () => {
    expect(isDue(state({ nextDueAt: T0, runningSince: T0 - 1_000 }), T0)).toBe(false);
  });

  it('is false while the job is backing off, however overdue it is', () => {
    expect(isDue(state({ nextDueAt: T0 - MINUTE, backoffUntil: T0 + MINUTE }), T0)).toBe(false);
    expect(isDue(state({ nextDueAt: T0 - MINUTE, backoffUntil: T0 }), T0)).toBe(true);
  });
});

describe('isLeaseExpired', () => {
  it('needs a lease to expire in the first place', () => {
    expect(isLeaseExpired(state(), 60_000, T0)).toBe(false);
  });

  it('is true only once the whole lease has elapsed', () => {
    expect(isLeaseExpired(state({ runningSince: T0 - 59_999 }), 60_000, T0)).toBe(false);
    expect(isLeaseExpired(state({ runningSince: T0 - 60_000 }), 60_000, T0)).toBe(true);
  });
});

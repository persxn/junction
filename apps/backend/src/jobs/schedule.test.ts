import { describe, expect, it } from 'vitest';

import type { JobStateRow } from '../db/schema/index.js';
import {
  applyJitter,
  backoffDelayMs,
  firstDueAt,
  isDue,
  isLeaseExpired,
  nextDueAfterRun,
} from './schedule.js';
import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS,
  registerable,
  type JobDefinition,
} from './types.js';

const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const MINUTE = 60_000;

/** `Math.random` is injected everywhere, so a fixed value pins the jitter. */
const mid = (): number => 0.5;
const low = (): number => 0;
const high = (): number => 0.999_999;

function row(overrides: Partial<JobStateRow> = {}): JobStateRow {
  return {
    jobKey: 'test',
    kind: 'GENERAL',
    lastRunAt: null,
    lastSuccessAt: null,
    nextDueAt: T0,
    runningSince: null,
    consecutiveFailures: 0,
    backoffUntil: null,
    lastOutcome: null,
    lastDurationMs: null,
    lastErrorMessage: null,
    ...overrides,
  };
}

function job(definition: Partial<JobDefinition> = {}) {
  return registerable({
    key: 'test',
    intervalMs: 15 * MINUTE,
    run: () => undefined,
    ...definition,
  });
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
    const base = DEFAULT_BACKOFF_BASE_MS;
    const max = DEFAULT_BACKOFF_MAX_MS;
    expect(backoffDelayMs(1, base, max)).toBe(15 * MINUTE);
    expect(backoffDelayMs(2, base, max)).toBe(30 * MINUTE);
    expect(backoffDelayMs(3, base, max)).toBe(60 * MINUTE);
    expect(backoffDelayMs(4, base, max)).toBe(120 * MINUTE);
  });

  it('caps at 12 hours however long the streak is', () => {
    const base = DEFAULT_BACKOFF_BASE_MS;
    const max = DEFAULT_BACKOFF_MAX_MS;
    expect(backoffDelayMs(20, base, max)).toBe(max);
    expect(backoffDelayMs(5_000, base, max)).toBe(max);
  });

  it('is zero without a failure', () => {
    expect(backoffDelayMs(0, DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_MAX_MS)).toBe(0);
  });
});

describe('nextDueAfterRun', () => {
  it('adds the jittered interval to the time the run finished', () => {
    expect(nextDueAfterRun(job(), row(), new Date(T0), mid)).toBe(T0 + 15 * MINUTE);
  });

  it('asks a wall-clock job for its own next due date', () => {
    const daily = registerable({
      key: 'backup:daily',
      nextDueAt: (from) => from.getTime() + 24 * 60 * MINUTE,
      run: () => undefined,
    });
    expect(nextDueAfterRun(daily, row(), new Date(T0), mid)).toBe(T0 + 1_440 * MINUTE);
  });

  it('lets the job override everything with retryAfterMs (Retry-After)', () => {
    expect(nextDueAfterRun(job(), row(), new Date(T0), mid, 90_000)).toBe(T0 + 90_000);
  });
});

describe('firstDueAt', () => {
  it('makes a new job due immediately by default', () => {
    expect(firstDueAt(job(), new Date(T0), mid)).toBe(T0);
  });

  it('waits one interval when the job asks to', () => {
    expect(firstDueAt(job({ firstRun: 'after-interval' }), new Date(T0), mid)).toBe(
      T0 + 15 * MINUTE,
    );
  });

  it('asks a wall-clock job, which is how backup:daily finds 13:00', () => {
    const daily = registerable({
      key: 'backup:daily',
      firstRun: 'after-interval',
      nextDueAt: (from) => from.getTime() + 60 * MINUTE,
      run: () => undefined,
    });
    expect(firstDueAt(daily, new Date(T0), mid)).toBe(T0 + 60 * MINUTE);
  });
});

describe('isDue', () => {
  it('is true once the due time has arrived', () => {
    expect(isDue(row({ nextDueAt: T0 }), T0)).toBe(true);
    expect(isDue(row({ nextDueAt: T0 + 1 }), T0)).toBe(false);
  });

  it('is true for a long-overdue job, which is what catch-up depends on', () => {
    expect(isDue(row({ nextDueAt: T0 - 8 * 60 * MINUTE }), T0)).toBe(true);
  });

  it('is false while a run holds the job', () => {
    expect(isDue(row({ nextDueAt: T0, runningSince: T0 - 1_000 }), T0)).toBe(false);
  });

  it('is false while the job is backing off, however overdue it is', () => {
    expect(isDue(row({ nextDueAt: T0 - MINUTE, backoffUntil: T0 + MINUTE }), T0)).toBe(false);
    expect(isDue(row({ nextDueAt: T0 - MINUTE, backoffUntil: T0 }), T0)).toBe(true);
  });
});

describe('isLeaseExpired', () => {
  it('needs a lease to expire in the first place', () => {
    expect(isLeaseExpired(row(), 60_000, T0)).toBe(false);
  });

  it('is true only once the whole lease has elapsed', () => {
    expect(isLeaseExpired(row({ runningSince: T0 - 59_999 }), 60_000, T0)).toBe(false);
    expect(isLeaseExpired(row({ runningSince: T0 - 60_000 }), 60_000, T0)).toBe(true);
  });
});

describe('registerable', () => {
  it('fills in the defaults from §4.9', () => {
    const registered = registerable({
      key: 'scrape:ctftime',
      intervalMs: 30 * MINUTE,
      run: () => undefined,
      kind: 'SCRAPE',
    });
    expect(registered.kind).toBe('SCRAPE');
    expect(registered.backoffBaseMs).toBe(DEFAULT_BACKOFF_BASE_MS);
    expect(registered.backoffMaxMs).toBe(DEFAULT_BACKOFF_MAX_MS);
  });

  it('defaults to the GENERAL pool', () => {
    expect(job().kind).toBe('GENERAL');
  });

  it('refuses a job that has no schedule at all', () => {
    expect(() => registerable({ key: 'x', run: () => undefined })).toThrow(/exactly one/);
  });

  it('refuses a job with two schedules, which would disagree', () => {
    expect(() =>
      registerable({ key: 'x', intervalMs: 1_000, nextDueAt: () => 0, run: () => undefined }),
    ).toThrow(/exactly one/);
  });

  it('refuses a non-positive interval, which would run forever', () => {
    expect(() => registerable({ key: 'x', intervalMs: 0, run: () => undefined })).toThrow(
      /non-positive/,
    );
  });

  it('refuses an empty key', () => {
    expect(() => registerable({ key: '  ', intervalMs: 1_000, run: () => undefined })).toThrow(
      /non-empty key/,
    );
  });
});

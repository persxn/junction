import { describe, expect, it } from 'vitest';

import type { JobStateRow } from '../db/schema/index.js';
import { firstDueAt, nextDueAfterRun } from './schedule.js';
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

import { describe, expect, it } from 'vitest';

import type { JobStateRow } from '../db/schema/index.js';
import { applyOutcome } from './outcome.js';
import { registerable, type JobDefinition } from './types.js';

const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const MINUTE = 60_000;
const mid = (): number => 0.5;

function row(overrides: Partial<JobStateRow> = {}): JobStateRow {
  return {
    jobKey: 'scrape:ctftime',
    kind: 'SCRAPE',
    lastRunAt: null,
    lastSuccessAt: null,
    nextDueAt: T0 - MINUTE,
    runningSince: T0 - 1_000,
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
    key: 'scrape:ctftime',
    kind: 'SCRAPE',
    intervalMs: 30 * MINUTE,
    run: () => undefined,
    ...definition,
  });
}

function apply(
  outcome: Parameters<typeof applyOutcome>[0]['outcome'],
  previous = row(),
  extra = {},
) {
  return applyOutcome({
    outcome,
    previous,
    job: job(),
    at: new Date(T0),
    durationMs: 1_234,
    random: mid,
    ...extra,
  });
}

describe('applyOutcome', () => {
  it('records a success and clears the failure streak', () => {
    const patch = apply('SUCCESS', row({ consecutiveFailures: 3, backoffUntil: T0 + MINUTE }));
    expect(patch.lastRunAt).toBe(T0);
    expect(patch.lastSuccessAt).toBe(T0);
    expect(patch.consecutiveFailures).toBe(0);
    expect(patch.backoffUntil).toBeNull();
    expect(patch.nextDueAt).toBe(T0 + 30 * MINUTE);
    expect(patch.lastDurationMs).toBe(1_234);
  });

  it('treats PARTIAL as healthy but does not stamp last_success_at (§7.6)', () => {
    const previous = row({ lastSuccessAt: T0 - 60 * MINUTE, consecutiveFailures: 2 });
    const patch = apply('PARTIAL', previous);
    expect(patch.lastSuccessAt).toBe(T0 - 60 * MINUTE);
    expect(patch.consecutiveFailures).toBe(0);
    expect(patch.nextDueAt).toBe(T0 + 30 * MINUTE);
  });

  it('backs a failure off by the first ladder step and pushes the due date with it', () => {
    const patch = apply('FAILED', row(), { errorMessage: 'connect ETIMEDOUT' });
    expect(patch.consecutiveFailures).toBe(1);
    expect(patch.backoffUntil).toBe(T0 + 15 * MINUTE);
    expect(patch.nextDueAt).toBe(patch.backoffUntil);
    expect(patch.lastErrorMessage).toBe('connect ETIMEDOUT');
  });

  it('doubles the backoff on the next consecutive failure', () => {
    const patch = apply('FAILED', row({ consecutiveFailures: 2 }));
    expect(patch.consecutiveFailures).toBe(3);
    expect(patch.backoffUntil).toBe(T0 + 60 * MINUTE);
  });

  it('counts a reclaimed lease as a failure, so a crashing job cannot loop', () => {
    const patch = apply('CRASHED', row({ consecutiveFailures: 0 }));
    expect(patch.consecutiveFailures).toBe(1);
    expect(patch.backoffUntil).toBe(T0 + 15 * MINUTE);
  });

  it('keeps an offline skip out of the failure streak (D-23)', () => {
    const patch = apply('SKIPPED_OFFLINE', row({ consecutiveFailures: 2 }));
    expect(patch.consecutiveFailures).toBe(2);
    expect(patch.lastRunAt).toBe(T0);
    expect(patch.lastSuccessAt).toBeNull();
    expect(patch.nextDueAt).toBe(T0 + 30 * MINUTE);
  });

  it('leaves an aborted run still due, which is how shutdown hands work back', () => {
    const previous = row({ nextDueAt: T0 - MINUTE, consecutiveFailures: 1 });
    const patch = apply('ABORTED', previous);
    expect(patch.nextDueAt).toBe(T0 - MINUTE);
    expect(patch.consecutiveFailures).toBe(1);
    expect(patch.lastOutcome).toBe('ABORTED');
  });

  it('honours retryAfterMs over the interval the job would otherwise use', () => {
    const patch = apply('SUCCESS', row(), { retryAfterMs: 5_000 });
    expect(patch.nextDueAt).toBe(T0 + 5_000);
  });

  it('truncates a long error message instead of storing a page of HTML', () => {
    const patch = apply('FAILED', row(), { errorMessage: 'x'.repeat(2_000) });
    expect(patch.lastErrorMessage).toHaveLength(500);
  });
});

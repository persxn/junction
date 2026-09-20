import { afterEach, describe, expect, it } from 'vitest';

import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';
import { JobStore } from './store.js';
import { registerable, type JobDefinition } from './types.js';

const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const MINUTE = 60_000;

const opened: MigratedDatabase[] = [];

afterEach(() => {
  while (opened.length > 0) {
    opened.pop()?.close();
  }
});

function store(): { store: JobStore; database: MigratedDatabase } {
  const database = openMigratedDatabase();
  opened.push(database);
  return { store: new JobStore(database.db), database };
}

function job(definition: Partial<JobDefinition> = {}) {
  return registerable({
    key: 'deadline-evaluator',
    intervalMs: 5 * MINUTE,
    run: () => undefined,
    ...definition,
  });
}

describe('the job_state migration', () => {
  it('creates the table the scheduler needs', () => {
    const { database } = store();
    const table = database.db.raw
      .prepare(`select name from sqlite_master where type = 'table' and name = 'job_state'`)
      .get();
    expect(table).toStrictEqual({ name: 'job_state' });
  });

  it('indexes next_due_at, which is the only column the tick filters on', () => {
    const { database } = store();
    const index = database.db.raw
      .prepare(`select name from sqlite_master where type = 'index' and name = ?`)
      .get('job_state_next_due_at_idx');
    expect(index).toBeDefined();
  });

  it('rejects a kind outside the contracts enum (§6.1 CHECK constraints)', () => {
    const { database } = store();
    expect(() =>
      database.db.raw
        .prepare('insert into job_state (job_key, kind, next_due_at) values (?, ?, ?)')
        .run('x', 'NONSENSE', T0),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects an outcome outside the contracts enum', () => {
    const { database } = store();
    expect(() =>
      database.db.raw
        .prepare('insert into job_state (job_key, next_due_at, last_outcome) values (?, ?, ?)')
        .run('x', T0, 'MAYBE'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects a negative failure count', () => {
    const { database } = store();
    expect(() =>
      database.db.raw
        .prepare(
          'insert into job_state (job_key, next_due_at, consecutive_failures) values (?, ?, ?)',
        )
        .run('x', T0, -1),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('JobStore.ensure', () => {
  it('creates the row with the given due date', () => {
    const { store: jobs } = store();
    const row = jobs.ensure(job(), T0);
    expect(row.jobKey).toBe('deadline-evaluator');
    expect(row.nextDueAt).toBe(T0);
    expect(row.kind).toBe('GENERAL');
    expect(row.consecutiveFailures).toBe(0);
    expect(row.runningSince).toBeNull();
  });

  it('keeps the existing schedule on a restart', () => {
    const { store: jobs } = store();
    jobs.ensure(job(), T0);
    jobs.finish('deadline-evaluator', {
      lastRunAt: T0,
      lastSuccessAt: T0,
      nextDueAt: T0 + 5 * MINUTE,
      consecutiveFailures: 0,
      backoffUntil: null,
      lastOutcome: 'SUCCESS',
      lastDurationMs: 12,
      lastErrorMessage: null,
    });
    const again = jobs.ensure(job(), T0 + 99 * MINUTE);
    expect(again.nextDueAt).toBe(T0 + 5 * MINUTE);
    expect(again.lastOutcome).toBe('SUCCESS');
  });

  it('follows the code when a job changes concurrency class', () => {
    const { store: jobs } = store();
    jobs.ensure(job(), T0);
    const moved = jobs.ensure(job({ kind: 'SCRAPE' }), T0);
    expect(moved.kind).toBe('SCRAPE');
  });
});

describe('JobStore.due', () => {
  it('returns only rows that are due, free and not backing off', () => {
    const { store: jobs } = store();
    jobs.ensure(job({ key: 'due' }), T0 - MINUTE);
    jobs.ensure(job({ key: 'later' }), T0 + MINUTE);
    jobs.ensure(job({ key: 'running' }), T0 - MINUTE);
    jobs.claim('running', T0 - 30_000);
    jobs.ensure(job({ key: 'backing-off' }), T0 - MINUTE);
    jobs.finish('backing-off', {
      lastRunAt: T0 - MINUTE,
      lastSuccessAt: null,
      nextDueAt: T0 - MINUTE,
      consecutiveFailures: 1,
      backoffUntil: T0 + 10 * MINUTE,
      lastOutcome: 'FAILED',
      lastDurationMs: 5,
      lastErrorMessage: 'nope',
    });

    expect(jobs.due(T0).map((row) => row.jobKey)).toStrictEqual(['due']);
  });

  it('puts the most overdue job first, so limits hit the freshest last', () => {
    const { store: jobs } = store();
    jobs.ensure(job({ key: 'recent' }), T0 - MINUTE);
    jobs.ensure(job({ key: 'ancient' }), T0 - 600 * MINUTE);
    expect(jobs.due(T0).map((row) => row.jobKey)).toStrictEqual(['ancient', 'recent']);
  });
});

describe('JobStore.claim', () => {
  it('is a single-flight lease: the second caller is refused', () => {
    const { store: jobs } = store();
    jobs.ensure(job(), T0);
    expect(jobs.claim('deadline-evaluator', T0)).toBe(true);
    expect(jobs.claim('deadline-evaluator', T0 + 1)).toBe(false);
    expect(jobs.read('deadline-evaluator')?.runningSince).toBe(T0);
  });

  it('refuses a job that does not exist', () => {
    const { store: jobs } = store();
    expect(jobs.claim('nope', T0)).toBe(false);
  });

  it('is free again once the run finishes', () => {
    const { store: jobs } = store();
    jobs.ensure(job(), T0);
    jobs.claim('deadline-evaluator', T0);
    jobs.finish('deadline-evaluator', {
      lastRunAt: T0,
      lastSuccessAt: T0,
      nextDueAt: T0 + 5 * MINUTE,
      consecutiveFailures: 0,
      backoffUntil: null,
      lastOutcome: 'SUCCESS',
      lastDurationMs: 1,
      lastErrorMessage: null,
    });
    expect(jobs.read('deadline-evaluator')?.runningSince).toBeNull();
    expect(jobs.claim('deadline-evaluator', T0 + 1)).toBe(true);
  });
});

describe('JobStore bookkeeping', () => {
  it('lists the leases a crashed process left behind', () => {
    const { store: jobs } = store();
    jobs.ensure(job({ key: 'a' }), T0);
    jobs.ensure(job({ key: 'b' }), T0);
    jobs.claim('a', T0);
    expect(jobs.running().map((row) => row.jobKey)).toStrictEqual(['a']);
  });

  it('clears the backoff and the streak for a forced manual run', () => {
    const { store: jobs } = store();
    jobs.ensure(job(), T0);
    jobs.finish('deadline-evaluator', {
      lastRunAt: T0,
      lastSuccessAt: null,
      nextDueAt: T0 + 60 * MINUTE,
      consecutiveFailures: 4,
      backoffUntil: T0 + 60 * MINUTE,
      lastOutcome: 'FAILED',
      lastDurationMs: 1,
      lastErrorMessage: 'nope',
    });
    jobs.clearBackoff('deadline-evaluator');
    const row = jobs.read('deadline-evaluator');
    expect(row?.backoffUntil).toBeNull();
    expect(row?.consecutiveFailures).toBe(0);
  });

  it('moves a due date on request', () => {
    const { store: jobs } = store();
    jobs.ensure(job(), T0);
    jobs.setNextDueAt('deadline-evaluator', T0 - MINUTE);
    expect(jobs.read('deadline-evaluator')?.nextDueAt).toBe(T0 - MINUTE);
  });

  it('exposes every row, soonest first, as snapshots', () => {
    const { store: jobs } = store();
    jobs.ensure(job({ key: 'late' }), T0 + MINUTE);
    jobs.ensure(job({ key: 'soon' }), T0);
    const snapshots = jobs.all().map((row) => JobStore.toSnapshot(row));
    expect(snapshots.map((snapshot) => snapshot.jobKey)).toStrictEqual(['soon', 'late']);
    expect(snapshots[0]).toStrictEqual({
      jobKey: 'soon',
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
    });
  });
});

import { STAGE_STATUSES, type StageStatus } from '@compintel/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { stageProgress, workflowProgress, type StageProgressInput } from './progress.js';

/**
 * §11 / A12 / R99, table-driven and exhaustive: every status × override
 * {absent, 0, 55, 100} × tasks {none, 0/3, 2/3, 3/3} — 80 cases — against the
 * precedence written out by hand a second time, plus the named cases the
 * acceptance list calls out.
 */

const OVERRIDES = [null, 0, 55, 100] as const;
const TASKS = [
  [0, 0],
  [0, 3],
  [2, 3],
  [3, 3],
] as const;

function expected(status: StageStatus, override: number | null, done: number, total: number) {
  if (status === 'SKIPPED') return null;
  if (status === 'COMPLETED') return 100;
  if (override !== null) return override;
  if (total > 0) return (done / total) * 100;
  return 0;
}

const cases = STAGE_STATUSES.flatMap((status) =>
  OVERRIDES.flatMap((override) =>
    TASKS.map(([done, total]) => [status, override, done, total] as const),
  ),
);

describe('stage progress precedence (§11, A12, R99)', () => {
  it('covers every status × override × tasks combination: 80 cases', () => {
    expect(cases).toHaveLength(80);
  });

  it.each(cases)('%s · override %s · %i/%i tasks', (status, override, done, total) => {
    const input: StageProgressInput = {
      status,
      progressOverride: override,
      tasksDone: done,
      tasksTotal: total,
    };
    const result = stageProgress(input);
    expect(result.value).toBe(expected(status, override, done, total));
    const manual = status !== 'SKIPPED' && status !== 'COMPLETED' && override !== null;
    expect(result.manual).toBe(manual);
  });

  const at = (patch: Partial<StageProgressInput>) =>
    stageProgress({
      status: 'IN_PROGRESS',
      progressOverride: null,
      tasksDone: 0,
      tasksTotal: 0,
      ...patch,
    }).value;

  it('SKIPPED with done tasks is excluded', () => {
    expect(at({ status: 'SKIPPED', tasksDone: 3, tasksTotal: 3 })).toBeNull();
  });
  it('COMPLETED with 0 of 3 tasks is 100', () => {
    expect(at({ status: 'COMPLETED', tasksDone: 0, tasksTotal: 3 })).toBe(100);
  });
  it('an override of 0 beats 3 of 3 tasks', () => {
    expect(at({ progressOverride: 0, tasksDone: 3, tasksTotal: 3 })).toBe(0);
  });
  it('an absent override falls through to the tasks', () => {
    expect(at({ tasksDone: 1, tasksTotal: 4 })).toBe(25);
  });
  it('BLOCKED keeps the computed 2 of 3 → 66.7', () => {
    expect(at({ status: 'BLOCKED', tasksDone: 2, tasksTotal: 3 })).toBeCloseTo(66.67, 1);
  });
  it('no tasks and no override is 0', () => {
    expect(at({})).toBe(0);
  });
});

describe('workflow progress (R99)', () => {
  it('all SKIPPED → null, with the reason', () => {
    expect(workflowProgress([{ weight: 2, progress: null }])).toEqual({
      value: null,
      reason: 'Every stage is skipped',
    });
  });
  it('counted weights summing to 0 → null, never 0 %', () => {
    expect(workflowProgress([{ weight: 0, progress: 80 }]).value).toBeNull();
  });
  it('no stages → null', () => {
    expect(workflowProgress([]).reason).toBe('No stages yet');
  });
  it('weights 1/3 and 3/1 give different answers', () => {
    const a = workflowProgress([
      { weight: 1, progress: 100 },
      { weight: 3, progress: 0 },
    ]).value;
    const b = workflowProgress([
      { weight: 3, progress: 100 },
      { weight: 1, progress: 0 },
    ]).value;
    expect(a).toBe(25);
    expect(b).toBe(75);
  });
  it('a SKIPPED stage’s weight never reaches the denominator', () => {
    expect(
      workflowProgress([
        { weight: 1, progress: 50 },
        { weight: 9, progress: null },
      ]).value,
    ).toBe(50);
  });
  it('is always null or between 0 and 100 (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            weight: fc.integer({ min: 0, max: 10 }),
            progress: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
          }),
          { maxLength: 20 },
        ),
        (stages) => {
          const { value } = workflowProgress(stages);
          return value === null || (value >= 0 && value <= 100 + 1e-9);
        },
      ),
    );
  });
});

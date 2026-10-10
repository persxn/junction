import { describe, expect, it } from 'vitest';

import {
  deadlineHit,
  funnel,
  milestones,
  participation,
  streaks,
  type StatusChange,
} from './aggregate.js';
import {
  daysInRange,
  defaultRange,
  monthsBetween,
  rangeSpan,
  weekOfDay,
  weeksBetween,
} from './calendar.js';

/**
 * Hand-computed expectations (WP-33, R69). The fixture, in IST:
 *   E1  considering 2 Jul → assigned 10 Jul → applied 20 Jul → participating 1 Sep → completed 10 Sep
 *   E2  considering 5 Jul → assigned 6 Jul → withdrawn 8 Jul
 *   E3  assigned 28 Sep (straight in), still active
 * Range 1 Jun – 30 Sep 2026; "now" 1 Oct 2026 10:00 IST. June has no activity at all.
 */

const at = (iso: string): number => Date.parse(iso);
const change = (engagementId: string, toStatus: StatusChange['toStatus'], iso: string) => ({
  engagementId,
  toStatus,
  changedAt: at(iso),
});

const HISTORY: StatusChange[] = [
  change('E1', 'CONSIDERING', '2026-07-02T06:00:00Z'),
  change('E1', 'ASSIGNED', '2026-07-10T06:00:00Z'),
  change('E1', 'APPLIED', '2026-07-20T06:00:00Z'),
  change('E1', 'PARTICIPATING', '2026-09-01T06:00:00Z'),
  change('E1', 'COMPLETED', '2026-09-10T06:00:00Z'),
  change('E2', 'CONSIDERING', '2026-07-05T06:00:00Z'),
  change('E2', 'ASSIGNED', '2026-07-06T06:00:00Z'),
  change('E2', 'WITHDRAWN', '2026-07-08T06:00:00Z'),
  change('E3', 'ASSIGNED', '2026-09-28T06:00:00Z'),
];
const NOW = at('2026-10-01T04:30:00Z');
const RANGE = { from: '2026-06-01', to: '2026-09-30', span: rangeSpan('2026-06-01', '2026-09-30') };

describe('the Insights calendar', () => {
  it('bounds a range by Kolkata days, half-open', () => {
    expect(new Date(RANGE.span.start).toISOString()).toBe('2026-05-31T18:30:00.000Z');
    expect(new Date(RANGE.span.end).toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });

  it('lists months across a year end and weeks from their Monday', () => {
    expect(monthsBetween('2025-11-15', '2026-02-01')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(weekOfDay('2026-10-14')).toBe(weekOfDay('2026-10-12'));
    expect(weekOfDay('2026-10-11')).toBe(weekOfDay('2026-10-12') - 7);
    expect(weeksBetween('2026-06-01', '2026-09-30')).toHaveLength(18);
  });

  it('defaults to the twelve months up to today', () => {
    expect(defaultRange('2026-10-10')).toEqual({ from: '2025-11-01', to: '2026-10-10' });
    expect(defaultRange('2026-12-31')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(daysInRange('2026-01-01', '2026-12-31')).toBe(365);
  });
});

describe('participation over time', () => {
  it('counts first assignments and active competitions per month, zero months included', () => {
    expect(participation(HISTORY, RANGE, NOW)).toEqual([
      { month: '2026-06', assigned: 0, active: 0 },
      { month: '2026-07', assigned: 2, active: 2 },
      { month: '2026-08', assigned: 0, active: 1 },
      { month: '2026-09', assigned: 1, active: 2 },
    ]);
  });
});

describe('the funnel', () => {
  const created = [
    { id: 'E1', status: 'COMPLETED' as const, createdAt: at('2026-07-02T06:00:00Z') },
    { id: 'E2', status: 'WITHDRAWN' as const, createdAt: at('2026-07-05T06:00:00Z') },
    { id: 'E3', status: 'ASSIGNED' as const, createdAt: at('2026-09-28T06:00:00Z') },
  ];

  it('counts each competition at the furthest step it reached', () => {
    expect(funnel(created, HISTORY).steps.map((step) => step.reached)).toEqual([3, 3, 1, 1, 1]);
  });

  it('keeps a withdrawn one in the totals but not in the completion rate', () => {
    const result = funnel(created, HISTORY);
    expect(result.total).toBe(3);
    expect(result.withdrawn).toBe(1);
    expect(result.notSelected).toBe(0);
    expect(result.completion).toEqual({ numerator: 1, denominator: 2 });
  });

  it('is all zeros, not an error, with nothing in the range', () => {
    expect(funnel([], HISTORY)).toEqual({
      steps: expect.any(Array) as unknown,
      total: 0,
      withdrawn: 0,
      notSelected: 0,
      completion: { numerator: 0, denominator: 0 },
    });
  });
});

describe('the deadline-hit rate', () => {
  it('counts met and missed for past-due stages in the range, undated apart', () => {
    const stages = [
      { dueAt: at('2026-08-01T12:00:00Z'), completedAt: at('2026-07-30T12:00:00Z') },
      { dueAt: at('2026-08-01T12:00:00Z'), completedAt: at('2026-08-03T12:00:00Z') },
      { dueAt: at('2026-08-15T12:00:00Z'), completedAt: null },
      // Not yet due: neither met nor missed.
      { dueAt: at('2026-10-20T12:00:00Z'), completedAt: null },
      // 1 Oct 01:30 IST — just past the range's last day.
      { dueAt: at('2026-09-30T20:00:00Z'), completedAt: null },
      { dueAt: null, completedAt: null },
    ];
    expect(deadlineHit(stages, RANGE.span, NOW)).toEqual({ met: 1, missed: 2, undated: 1 });
  });
});

describe('streaks', () => {
  it('counts Monday weeks with an active competition', () => {
    expect(streaks(HISTORY, RANGE, NOW)).toEqual({
      activeWeeks: 11,
      weeksInRange: 18,
      longest: 10,
      current: 1,
    });
  });

  it('never counts a week that has not happened yet', () => {
    const future = {
      from: '2026-09-01',
      to: '2026-12-31',
      span: rangeSpan('2026-09-01', '2026-12-31'),
    };
    expect(streaks(HISTORY, future, NOW).weeksInRange).toBe(
      weeksBetween('2026-09-01', '2026-10-01').length,
    );
  });
});

describe('milestones', () => {
  it('names only facts that are recorded', () => {
    const found = milestones(HISTORY, [at('2026-09-12T00:00:00Z')], NOW);
    expect(found).toEqual([
      {
        kind: 'FIRST_WINNER',
        id: 'FIRST_WINNER',
        at: '2026-09-12T00:00:00.000Z',
        title: 'First win recorded',
      },
      {
        kind: 'FOUR_WEEK_STREAK',
        id: 'FOUR_WEEK_STREAK',
        at: '2026-07-26T18:30:00.000Z',
        title: 'Four weeks in a row with an active competition',
      },
    ]);
  });

  it('marks the tenth completion, not the ninth', () => {
    const nine = Array.from({ length: 9 }, (_, i) =>
      change(`C${String(i)}`, 'COMPLETED', `2026-08-${String(10 + i)}T06:00:00Z`),
    );
    expect(milestones(nine, [], NOW).some((m) => m.kind === 'TENTH_COMPLETED')).toBe(false);
    const ten = [...nine, change('C9', 'COMPLETED', '2026-08-25T06:00:00Z')];
    expect(milestones(ten, [], NOW).find((m) => m.kind === 'TENTH_COMPLETED')?.at).toBe(
      '2026-08-25T06:00:00.000Z',
    );
  });

  it('is empty for a fresh install', () => {
    expect(milestones([], [], NOW)).toEqual([]);
  });
});

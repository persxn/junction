import { describe, expect, it } from 'vitest';

import { resolveDueAt, type EventDates } from './due.js';
import { scheduleHealth, type HealthStage } from './health.js';
import { MIN_GAP, place, POSITION_STEP, type Positioned } from './order.js';

/** R99 health, R100 due rules and R101 ordering — under a fixed `now`, in IST. */

const ZONE = 'Asia/Kolkata';
// 8 Oct 2026, 10:00 IST.
const NOW = Date.parse('2026-10-08T04:30:00.000Z');
const HOUR = 3_600_000;

const stage = (patch: Partial<HealthStage>): HealthStage => ({
  name: 'Build',
  status: 'IN_PROGRESS',
  dueAt: null,
  progress: 0,
  tasksDone: 0,
  tasksTotal: 0,
  blockedReason: null,
  ...patch,
});
const health = (stages: HealthStage[]) => scheduleHealth({ stages, now: NOW, zone: ZONE });

describe('schedule health (R99)', () => {
  it('BLOCKED beats OVERDUE, and names the reason', () => {
    expect(
      health([
        stage({ name: 'Deck', status: 'BLOCKED', blockedReason: 'Waiting for data' }),
        stage({ name: 'Old', dueAt: NOW - 3 * 24 * HOUR }),
        stage({ name: 'Other', status: 'BLOCKED', blockedReason: 'x' }),
      ]),
    ).toEqual({ health: 'BLOCKED', reason: 'Blocked: Deck — Waiting for data and 1 more' });
  });

  it('OVERDUE: one stage, and several', () => {
    expect(health([stage({ name: 'PPT', dueAt: NOW - 2 * 24 * HOUR, progress: 40 })])).toEqual({
      health: 'OVERDUE',
      reason: 'PPT was due 2 days ago, 40% done',
    });
    expect(
      health([
        stage({ name: 'A', dueAt: NOW - 5 * 24 * HOUR }),
        stage({ name: 'B', dueAt: NOW - HOUR }),
      ]).reason,
    ).toBe('2 stages overdue — oldest A');
  });

  it('a date-only due today is not overdue until the local day ends', () => {
    const endOfToday = Date.parse('2026-10-08T18:29:59.999Z'); // 23:59:59.999 IST
    const result = health([stage({ name: 'Form', dueAt: endOfToday, progress: 0 })]);
    expect(result.health).toBe('AT_RISK');
    expect(result.reason).toBe('Form due today, 0% done');
  });

  it('AT_RISK at 47 h but not 49 h; under 50 % but not at 50 %', () => {
    const tasks = { tasksDone: 1, tasksTotal: 4, progress: 25 };
    expect(health([stage({ name: 'PPT', dueAt: NOW + 47 * HOUR, ...tasks })])).toEqual({
      health: 'AT_RISK',
      reason: 'PPT due in 2 days, 1 of 4 tasks done',
    });
    expect(health([stage({ dueAt: NOW + 49 * HOUR, ...tasks })]).health).toBe('ON_TRACK');
    expect(health([stage({ dueAt: NOW + 24 * HOUR, progress: 49 })]).health).toBe('AT_RISK');
    expect(health([stage({ dueAt: NOW + 24 * HOUR, progress: 50 })]).health).toBe('ON_TRACK');
  });

  it('ON_TRACK names the next date, and counts undated stages', () => {
    expect(
      health([
        stage({ name: 'Submit', dueAt: Date.parse('2026-10-20T12:00:00.000Z') }),
        stage({ name: 'Wrap-up' }),
      ]),
    ).toEqual({ health: 'ON_TRACK', reason: 'Next: Submit due 20 Oct · 1 stage has no date' });
    expect(health([stage({ status: 'COMPLETED' }), stage({ status: 'SKIPPED' })])).toEqual({
      health: 'ON_TRACK',
      reason: 'All stages done',
    });
  });

  it('NO_DATES when nothing open is dated, or nothing exists', () => {
    expect(health([stage({}), stage({ status: 'COMPLETED', dueAt: NOW - HOUR })])).toEqual({
      health: 'NO_DATES',
      reason: 'No stage has a date yet',
    });
    expect(health([]).reason).toBe('No stages yet');
  });
});

describe('due rules (R100)', () => {
  const DATETIME = Date.parse('2026-10-31T13:30:00.000Z'); // 31 Oct, 19:00 IST
  const DATE_ONLY = Date.parse('2026-10-31T18:29:59.999Z'); // 31 Oct, end of day IST
  const dates: EventDates = {
    registrationDeadline: { at: DATE_ONLY, precision: 'DATE' },
    submissionDeadline: { at: DATETIME, precision: 'DATETIME' },
    start: { at: DATETIME, precision: 'MONTH' },
    end: null,
    deadlines: [
      { kind: 'PPT', at: Date.parse('2026-11-05T06:30:00.000Z'), precision: 'DATETIME' },
      { kind: 'PPT', at: Date.parse('2026-11-02T06:30:00.000Z'), precision: 'DATETIME' },
    ],
  };
  const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString());

  it('a date-only anchor resolves to the end of the shifted local day', () => {
    expect(
      iso(resolveDueAt({ anchor: 'REGISTRATION_DEADLINE', offsetDays: -2 }, dates, ZONE)),
    ).toBe('2026-10-29T18:29:59.999Z');
  });

  it('a timed anchor keeps its time of day, across a month end both ways', () => {
    expect(iso(resolveDueAt({ anchor: 'SUBMISSION_DEADLINE', offsetDays: 3 }, dates, ZONE))).toBe(
      '2026-11-03T13:30:00.000Z',
    );
    expect(iso(resolveDueAt({ anchor: 'SUBMISSION_DEADLINE', offsetDays: -31 }, dates, ZONE))).toBe(
      '2026-09-30T13:30:00.000Z',
    );
  });

  it('DEADLINE takes the earliest row of its kind', () => {
    expect(
      iso(resolveDueAt({ anchor: 'DEADLINE', kind: 'PPT', offsetDays: -1 }, dates, ZONE)),
    ).toBe('2026-11-01T06:30:00.000Z');
  });

  it('a missing anchor, or a MONTH-precision one, gives no date', () => {
    expect(resolveDueAt({ anchor: 'EVENT_END', offsetDays: 7 }, dates, ZONE)).toBeNull();
    expect(resolveDueAt({ anchor: 'EVENT_START', offsetDays: 0 }, dates, ZONE)).toBeNull();
    expect(
      resolveDueAt({ anchor: 'DEADLINE', kind: 'ABSTRACT', offsetDays: 0 }, dates, ZONE),
    ).toBeNull();
  });
});

describe('ordering (R101)', () => {
  const rows = (n: number): Positioned[] =>
    Array.from({ length: n }, (_unused, index) => ({
      id: `s${String(index)}`,
      position: (index + 1) * POSITION_STEP,
    }));

  it('places before, after and at the end by midpoint', () => {
    expect(place(rows(3), { beforeId: 's1' }, 'x').position).toBe(1536);
    expect(place(rows(3), { afterId: 's2' }, 'x').position).toBe(4096);
    expect(place(rows(3), {}, 'x').position).toBe(4096);
    expect(place([], {}, 'x').position).toBe(POSITION_STEP);
  });

  // Each insert at one spot halves the gap: 1024 / 2^30 ≈ 9.5e-7 < 1e-6, so the
  // 30th insert renumbers, and so does the 60th — one renumber per 30 inserts.
  // (The WP-20a prompt says "60 inserts → one renumber"; R101's own numbers give
  // two. Raised with the architect.)
  it('60 inserts at one spot renumber once per 30 and keep the order', () => {
    let list = rows(2);
    const renumberedAt: number[] = [];
    const inserted: string[] = [];
    for (let n = 0; n < 60; n += 1) {
      const id = `n${String(n)}`;
      const result = place(list, { beforeId: 's1' }, id);
      if (result.renumbered !== undefined) {
        renumberedAt.push(n + 1);
        list = [...result.renumbered];
      } else {
        list = [...list, { id, position: result.position }];
      }
      inserted.push(id);
    }
    expect(renumberedAt).toEqual([30, 60]);
    const order = [...list].sort((a, b) => a.position - b.position).map((row) => row.id);
    // Each insert goes just before s1, so they read in insertion order between s0 and s1.
    expect(order).toEqual(['s0', ...inserted, 's1']);
    const gaps = [...list]
      .sort((a, b) => a.position - b.position)
      .slice(1)
      .map(
        (row, index, sorted) =>
          row.position -
          (index === 0 ? list.find((r) => r.id === 's0')!.position : sorted[index - 1]!.position),
      );
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN_GAP);
  });
});

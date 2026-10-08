import { describe, expect, it } from 'vitest';

import {
  bucketBounds,
  dueItems,
  effectiveDueAt,
  sourceLabelOf,
  urgencyOf,
  type DeadlineRow,
} from './buckets.js';

/** Buckets on Kolkata calendar days (WP-22, R106–R107, ADR-0015, A7), with an injected `now`. */

const ist = (iso: string): number => Date.parse(`${iso}+05:30`);
// 9 Oct 2026, 10:00 IST.
const NOW = ist('2026-10-09T10:00:00');

const row = (patch: Partial<DeadlineRow>): DeadlineRow => ({
  id: 'r',
  itemKind: 'TASK',
  deadlineKind: null,
  label: 'Thing',
  dueAt: NOW,
  precision: 'DATETIME',
  eventId: '0192f0c1-0000-7000-8000-000000000001',
  eventTitle: 'Synthetic Hack',
  eventTimezone: null,
  engagementId: null,
  competitionName: null,
  teamId: null,
  teamName: null,
  stageId: null,
  taskId: null,
  origin: 'TASK',
  sourceName: null,
  ...patch,
});

describe('bucket edges on Kolkata days', () => {
  const bounds = bucketBounds(NOW);

  it('cuts at the end of today, today + 3 and today + 7 in IST', () => {
    expect(new Date(bounds.endOfToday).toISOString()).toBe('2026-10-09T18:30:00.000Z');
    expect(new Date(bounds.endOfDay3).toISOString()).toBe('2026-10-12T18:30:00.000Z');
    expect(new Date(bounds.endOfDay7).toISOString()).toBe('2026-10-16T18:30:00.000Z');
  });

  it('23:59:59 IST today is TODAY; 00:00 tomorrow is ≤ 3 DAYS; earlier today is OVERDUE', () => {
    expect(urgencyOf(ist('2026-10-09T23:59:59'), bounds)).toBe('TODAY');
    expect(urgencyOf(ist('2026-10-10T00:00:00'), bounds)).toBe('DAYS_3');
    expect(urgencyOf(ist('2026-10-09T09:59:59'), bounds)).toBe('OVERDUE');
    expect(urgencyOf(ist('2026-10-12T23:59:59'), bounds)).toBe('DAYS_3');
    expect(urgencyOf(ist('2026-10-13T00:00:00'), bounds)).toBe('DAYS_7');
    expect(urgencyOf(ist('2026-10-17T00:00:00'), bounds)).toBe('LATER');
  });

  it('a UTC midnight that is already the next IST day falls on the IST day', () => {
    // 2026-10-09T20:00Z is 10 Oct 01:30 IST — tomorrow here, though "today" in UTC.
    expect(urgencyOf(Date.parse('2026-10-09T20:00:00Z'), bounds)).toBe('DAYS_3');
    // 2026-10-09T18:00Z is 9 Oct 23:30 IST — still today.
    expect(urgencyOf(Date.parse('2026-10-09T18:00:00Z'), bounds)).toBe('TODAY');
  });
});

describe('precision (ADR-0015)', () => {
  it('a DATE deadline "today" stays TODAY until the Kolkata day ends, never overdue at noon', () => {
    const [item] = dueItems([row({ precision: 'DATE', dueAt: ist('2026-10-09T00:00:00') })], NOW);
    expect(item?.bucket).toBe('TODAY');
    expect(item?.dueAt).toBe('2026-10-09T18:29:59.999Z');
  });

  it('a DATE deadline in another zone ends that day there', () => {
    // 9 Oct in New York ends 10 Oct 04:00 UTC — 09:30 IST tomorrow.
    const at = effectiveDueAt({
      dueAt: Date.parse('2026-10-09T12:00:00Z'),
      precision: 'DATE',
      eventTimezone: 'America/New_York',
    });
    expect(new Date(at!).toISOString()).toBe('2026-10-10T03:59:59.999Z');
    expect(urgencyOf(at!, bucketBounds(NOW))).toBe('DAYS_3');
  });

  it('a MONTH date is the end of that month; an UNKNOWN date is left out', () => {
    expect(
      new Date(
        effectiveDueAt({
          dueAt: ist('2026-10-15T00:00:00'),
          precision: 'MONTH',
          eventTimezone: null,
        })!,
      ).toISOString(),
    ).toBe('2026-10-31T18:29:59.999Z');
    expect(dueItems([row({ precision: 'UNKNOWN' })], NOW)).toEqual([]);
  });
});

describe('what stays in the model (R106)', () => {
  it('a past event deadline leaves; a past open task is OVERDUE', () => {
    const items = dueItems(
      [
        row({
          id: 'event',
          itemKind: 'EVENT_DEADLINE',
          origin: 'SOURCE',
          dueAt: ist('2026-10-08T12:00:00'),
        }),
        row({ id: 'task', dueAt: ist('2026-10-07T12:00:00') }),
      ],
      NOW,
    );
    expect(items.map((item) => [item.id, item.bucket, item.daysLeft])).toEqual([
      ['task', 'OVERDUE', -2],
    ]);
  });

  it('sorts by due time, then id, and says where each came from', () => {
    const items = dueItems(
      [
        row({ id: 'b', dueAt: ist('2026-10-11T09:00:00') }),
        row({ id: 'a', dueAt: ist('2026-10-11T09:00:00') }),
        row({
          id: 'c',
          itemKind: 'EVENT_DEADLINE',
          origin: 'SOURCE',
          sourceName: 'Devfolio',
          dueAt: ist('2026-10-10T09:00:00'),
        }),
      ],
      NOW,
    );
    expect(items.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(items[0]?.sourceLabel).toBe('Stated by Devfolio');
    expect(sourceLabelOf({ origin: 'MANUAL', sourceName: null })).toBe('Entered manually');
    expect(sourceLabelOf({ origin: 'STAGE', sourceName: null })).toBe('Workflow stage');
  });
});

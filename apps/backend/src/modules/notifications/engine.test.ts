import type { DueItem } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { DAY, HOUR, openBench, thresholdOf, type Bench } from '../../testing/notifications.js';

/**
 * The engine over real `v_deadlines` items and an injected clock (WP-23,
 * R108, R110, R111): each threshold fires once, a catch-up after sleep fires
 * only the most urgent, a moved deadline re-arms, snooze comes back on the
 * evaluator's own tick.
 */

let bench: Bench | undefined;
afterEach(async () => {
  await bench?.close();
  bench = undefined;
});

const at = (iso: string): number => Date.parse(iso);
const taskRows = (b: Bench) => b.rows('TASK').filter((row) => row.userId === b.h.alice.id);

describe('thresholds (R108)', () => {
  it('ten runs across the days fire 7 d, 3 d, 1 d, due day and overdue — one each', async () => {
    // Due 9 Oct, 11:30 IST; the bench starts 1 Oct, 10:00 IST.
    const b = (bench = await openBench('2026-10-09T06:00:00.000Z'));
    for (const iso of [
      '2026-10-01T04:30:00.000Z',
      '2026-10-03T04:30:00.000Z',
      '2026-10-04T04:30:00.000Z',
      '2026-10-06T04:30:00.000Z',
      '2026-10-07T04:30:00.000Z',
      '2026-10-08T04:30:00.000Z',
      '2026-10-09T04:30:00.000Z',
      '2026-10-09T07:00:00.000Z',
      '2026-10-10T04:30:00.000Z',
      '2026-10-11T04:30:00.000Z',
    ]) {
      b.runAt(at(iso));
    }
    const rows = taskRows(b);
    expect(rows.map((row) => thresholdOf(row.dedupeKey))).toEqual([
      'D7',
      'D3',
      'D1',
      'DUE_DAY',
      'OVERDUE',
    ]);
    expect(rows.map((row) => row.severity)).toEqual([
      'INFO',
      'INFO',
      'WARNING',
      'CRITICAL',
      'CRITICAL',
    ]);
    expect(rows.at(-1)?.type).toBe('OVERDUE');
    // A second run in the same minute inserts nothing.
    b.runAt(b.now());
    expect(taskRows(b)).toHaveLength(5);
  });

  it('after sleep from 4 d to 20 h before, the catch-up fires 1 d only — 3 d never', async () => {
    // Due 9 Oct, 18:00 IST.
    const due = at('2026-10-09T12:30:00.000Z');
    const b = (bench = await openBench('2026-10-09T12:30:00.000Z'));
    b.runAt(due - 4 * DAY);
    b.runAt(due - 20 * HOUR);
    expect(taskRows(b).map((row) => thresholdOf(row.dedupeKey))).toEqual(['D7', 'D1']);
    b.runAt(due - 15 * HOUR);
    b.runAt(due - 10 * HOUR);
    const fired = taskRows(b).map((row) => thresholdOf(row.dedupeKey));
    expect(fired).not.toContain('D3');
    expect(fired).toEqual(['D7', 'D1', 'DUE_DAY']);
  });

  it('a moved deadline re-arms; moved earlier past two thresholds fires one', async () => {
    const b = (bench = await openBench('2026-10-20T06:00:00.000Z'));
    const base = b.h.deadlines.service
      .everything(b.now())
      .find((item) => item.taskId === b.taskId)!;
    const as = (patch: Partial<DueItem>) => () => [{ ...base, ...patch }];
    b.runAt(b.now(), as({ dueAt: '2026-10-06T06:00:00.000Z', daysLeft: 5, bucket: 'DAYS_7' }));
    // Later: nothing until the new date's 7 d, then 7 d again on the new key.
    b.runAt(
      b.now() + HOUR,
      as({ dueAt: '2026-10-10T06:00:00.000Z', daysLeft: 9, bucket: 'LATER' }),
    );
    expect(taskRows(b)).toHaveLength(1);
    b.runAt(
      b.now() + HOUR,
      as({ dueAt: '2026-10-10T06:00:00.000Z', daysLeft: 6, bucket: 'DAYS_7' }),
    );
    // Earlier, past 3 d and 1 d at once: one notification, the most urgent.
    b.runAt(
      b.now() + HOUR,
      as({ dueAt: '2026-10-02T06:00:00.000Z', daysLeft: 1, bucket: 'DAYS_3' }),
    );
    expect(taskRows(b).map((row) => thresholdOf(row.dedupeKey))).toEqual(['D7', 'D7', 'D1']);
  });

  it('a DATE deadline’s due day is its Kolkata day', async () => {
    const b = (bench = await openBench('2026-10-30T06:00:00.000Z'));
    const { makeEvent } = await import('../../testing/competitions.js');
    const eventId = makeEvent(b.h, { registrationDeadlineAt: at('2026-10-09T06:00:00.000Z') });
    b.h.database.db.raw
      .prepare('INSERT INTO watchlist_items (user_id, event_id, added_at) VALUES (?, ?, 0)')
      .run(b.h.alice.id, eventId);
    const mine = () => b.rows('EVENT_DEADLINE').filter((row) => row.dedupeKey.includes(eventId));
    // 8 Oct, 23:00 IST — still the day before.
    b.runAt(at('2026-10-08T17:30:00.000Z'));
    expect(mine().map((row) => thresholdOf(row.dedupeKey))).toEqual(['D1']);
    // 9 Oct, 00:30 IST — the due day.
    b.runAt(at('2026-10-08T19:00:00.000Z'));
    expect(mine().map((row) => thresholdOf(row.dedupeKey))).toEqual(['D1', 'DUE_DAY']);
  });
});

describe('snooze (R111)', () => {
  it('hides until `until`; one tick later it is back, unread and published; dismissed never returns', async () => {
    const b = (bench = await openBench('2026-10-30T06:00:00.000Z'));
    const seen = b.listen(b.h.alice.id);
    const [kept, gone] = ['one', 'two'].map(
      (key) =>
        b.engine.emit({
          type: 'SYSTEM',
          recipients: [b.h.alice.id],
          title: key,
          body: '',
          route: null,
          dedupeKey: key,
        })[0]!,
    );
    const until = b.now() + HOUR;
    const raw = b.h.database.db.raw;
    raw
      .prepare('UPDATE notifications SET snoozed_until = ?, read_at = ? WHERE id IN (?, ?)')
      .run(until, b.now(), kept, gone);
    raw.prepare('UPDATE notifications SET dismissed_at = ? WHERE id = ?').run(b.now(), gone);
    expect(b.repo.unreadCount(b.h.alice.id, b.now())).toBe(0);
    b.runAt(until - 5 * 60_000);
    expect(b.rows().find((row) => row.id === kept)?.snoozedUntil).toBe(until);
    b.runAt(until + 5 * 60_000);
    const back = b.rows().find((row) => row.id === kept)!;
    expect(back).toMatchObject({ snoozedUntil: null, readAt: null });
    expect(seen.at(-1)).toMatchObject({
      type: 'notification.updated',
      payload: { id: kept, unreadCount: 1 },
    });
    expect(b.rows().find((row) => row.id === gone)?.snoozedUntil).toBe(until);
    expect(b.repo.unreadCount(b.h.alice.id, b.now())).toBe(1);
  });
});

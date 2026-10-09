import type { DueItem } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { uuid7 } from '../../platform/ids.js';
import { makeEvent } from '../../testing/competitions.js';
import { DAY, openBench, thresholdOf, type Bench } from '../../testing/notifications.js';
import { insertSource } from '../../testing/scraping.js';

/**
 * R109 recipients, preferences and the stream (WP-23): an ended co-mentor gets
 * nothing, the person who moved a deadline is not told, a saved-only event is
 * never overdue, admin notices reach admins only and re-arm on recurrence, a
 * preference turns a type off or overrides thresholds, and one user's stream
 * never carries another's notification.
 */

let bench: Bench | undefined;
afterEach(async () => {
  await bench?.close();
  bench = undefined;
});

const DUE = '2026-10-04T06:00:00.000Z'; // 3 days after the bench starts.
const save = (b: Bench, userId: string, eventId: string): void => {
  b.h.database.db.raw
    .prepare('INSERT INTO watchlist_items (user_id, event_id, added_at) VALUES (?, ?, 0)')
    .run(userId, eventId);
};
const usersOf = (b: Bench, kind: string): string[] =>
  [...new Set(b.rows(kind).map((row) => row.userId))].sort();

describe('recipients (R109)', () => {
  it('active primary and co-mentor get the work; a co-mentor whose period ended does not', async () => {
    const b = (bench = await openBench(DUE));
    const cara = b.h.user('Cara Current', ['PROFESSOR']);
    const raw = b.h.database.db.raw;
    const mentor = raw.prepare(
      `INSERT INTO engagement_mentors (id, engagement_id, user_id, role, from_at, to_at) VALUES (?, ?, ?, 'CO_MENTOR', ?, ?)`,
    );
    mentor.run(uuid7(), b.competitionId, cara.id, 0, null);
    mentor.run(uuid7(), b.competitionId, b.h.bob.id, 0, b.now() - DAY);
    b.runAt(b.now());
    expect(usersOf(b, 'TASK')).toEqual([b.h.alice.id, cara.id].sort());
  });

  it('a saved-only event never produces OVERDUE', async () => {
    const b = (bench = await openBench(DUE));
    const eventId = makeEvent(b.h);
    save(b, b.h.bob.id, eventId);
    const item: DueItem = {
      ...b.h.deadlines.service.everything(b.now()).find((i) => i.taskId === b.taskId)!,
      id: `event-reg:${eventId}`,
      itemKind: 'EVENT_DEADLINE',
      deadlineKind: 'REGISTRATION',
      eventId,
      engagementId: null,
      taskId: null,
      stageId: null,
      bucket: 'OVERDUE',
      daysLeft: 0,
    };
    b.runAt(b.now(), () => [item]);
    const bobs = b.rows('EVENT_DEADLINE').filter((row) => row.userId === b.h.bob.id);
    expect(bobs.map((row) => thresholdOf(row.dedupeKey))).toEqual(['DUE_DAY']);
    expect(bobs.some((row) => row.type === 'OVERDUE')).toBe(false);
  });

  it('a moved deadline tells the watchers — never the person who moved it', async () => {
    const b = (bench = await openBench(DUE));
    const eventId = makeEvent(b.h, { title: 'Watched Hack' });
    save(b, b.h.alice.id, eventId);
    save(b, b.h.bob.id, eventId);
    b.runAt(b.now(), () => []); // first run: the watermark starts here
    b.h.database.db.raw
      .prepare(
        `INSERT INTO event_changes (id, event_id, field, old_value_json, new_value_json, cause, changed_by, detected_at)
         VALUES (?, ?, 'registrationDeadlineAt', ?, ?, 'OVERRIDE', ?, ?)`,
      )
      .run(
        uuid7(),
        eventId,
        String(b.now() + 9 * DAY),
        String(b.now() + 5 * DAY),
        b.h.bob.id,
        b.now(),
      );
    b.runAt(b.now() + 60_000, () => []);
    const changed = b.rows('event');
    expect(changed.map((row) => [row.userId, row.type, row.severity])).toEqual([
      [b.h.alice.id, 'EVENT_CHANGED', 'WARNING'],
    ]);
    b.runAt(b.now() + 60_000, () => []);
    expect(b.rows('event')).toHaveLength(1);
  });

  it('admin notices go to admins only, once per episode, and re-arm when it recurs', async () => {
    const b = (bench = await openBench(DUE));
    const source = insertSource(b.h.database.db, {
      complianceStatus: 'BLOCKED',
      name: 'Synthetic Source',
    });
    b.runAt(b.now(), () => []);
    b.runAt(b.now() + 60_000, () => []);
    expect(b.rows('source').map((row) => [row.userId, row.type])).toEqual([
      [b.h.admin.id, 'SOURCE_BLOCKED'],
    ]);
    const set = b.h.database.db.raw.prepare(
      'UPDATE sources SET compliance_status = ? WHERE id = ?',
    );
    set.run('APPROVED', source.id);
    b.runAt(b.now() + 60_000, () => []);
    set.run('BLOCKED', source.id);
    b.runAt(b.now() + 60_000, () => []);
    expect(b.rows('source')).toHaveLength(2);
  });
});

describe('preferences', () => {
  const prefer = (b: Bench, type: string, enabled: boolean, thresholds: string | null): void => {
    b.h.database.db.raw
      .prepare(
        `INSERT INTO notification_preferences (user_id, type, is_enabled, thresholds_json, toast_enabled) VALUES (?, ?, ?, ?, 1)`,
      )
      .run(b.h.alice.id, type, enabled ? 1 : 0, thresholds);
  };

  it('a type turned off makes no row', async () => {
    const b = (bench = await openBench(DUE));
    prefer(b, 'TASK_DUE', false, null);
    b.runAt(b.now());
    expect(b.rows('TASK')).toEqual([]);
  });

  it('a threshold override [14, 2] is honoured', async () => {
    const b = (bench = await openBench('2026-10-11T06:00:00.000Z'));
    prefer(b, 'TASK_DUE', true, JSON.stringify({ days: [14, 2], dueDay: true, overdue: true }));
    b.runAt(b.now());
    expect(b.rows('TASK').map((row) => thresholdOf(row.dedupeKey))).toEqual(['D14']);
  });
});

describe('stream (R36)', () => {
  it('the recipient’s stream receives the id; another user’s does not', async () => {
    const b = (bench = await openBench(DUE));
    const alice = b.listen(b.h.alice.id);
    const bob = b.listen(b.h.bob.id);
    b.runAt(b.now());
    const [row] = b.rows('TASK');
    expect(alice).toContainEqual(
      expect.objectContaining({
        type: 'notification.created',
        payload: { id: row!.id, unreadCount: 1 },
      }),
    );
    expect(bob.filter((event) => event.type.startsWith('notification'))).toEqual([]);
  });
});

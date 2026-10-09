import type { NotificationList, NotificationPreferences } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HOUR, openBench, type Bench } from '../testing/notifications.js';
import { call } from '../testing/students.js';

/**
 * The inbox API (WP-23, R111): a person's own rows only, snoozed and dismissed
 * hidden, read/unread/snooze/dismiss/undo, read-all, and preferences that fall
 * back to the registry and take effect at once.
 */

let b: Bench;
let ids: string[];
beforeAll(async () => {
  b = await openBench('2026-10-30T06:00:00.000Z');
  ids = ['first', 'second', 'third'].map(
    (key, index) =>
      b.engine.emit(
        {
          type: index === 2 ? 'BACKUP_FAILED' : 'SYSTEM',
          recipients: [b.h.alice.id],
          title: key,
          body: '',
          route: '/admin/backups',
          dedupeKey: key,
        },
        b.now() + index,
      )[0]!,
  );
});
afterAll(async () => {
  await b.close();
});

const list = async (query = '', as = b.h.alice): Promise<NotificationList> => {
  const response = await call(b.server, 'GET', `/api/v1/notifications${query}`, { as });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as unknown as NotificationList;
};
const post = (path: string, body?: unknown, as = b.h.alice) =>
  call(b.server, 'POST', `/api/v1/notifications/${path}`, {
    as,
    ...(body === undefined ? {} : { body }),
  });

describe('the inbox', () => {
  it('lists my own newest first, pages by cursor, and never shows another person’s', async () => {
    const page = await list('?limit=2');
    expect(page.items.map((item) => item.title)).toEqual(['third', 'second']);
    expect(page.unreadCount).toBe(3);
    expect(page.items[0]).toMatchObject({
      severity: 'CRITICAL',
      toast: true,
      route: '/admin/backups',
    });
    const next = await list(`?limit=2&cursor=${page.nextCursor!}`);
    expect(next.items.map((item) => item.title)).toEqual(['first']);
    expect((await list('', b.h.bob)).items).toEqual([]);
    expect((await post(`${ids[0]!}/read`, undefined, b.h.bob)).status).toBe(404);
  });

  it('read, unread, dismiss with undo, snooze and read-all move the count', async () => {
    const [first, second, third] = ids as [string, string, string];
    expect((await post(`${first}/read`)).body).toEqual({ unreadCount: 2 });
    expect((await list('?state=unread')).items.map((item) => item.id)).not.toContain(first);
    expect((await post(`${first}/unread`)).body).toEqual({ unreadCount: 3 });
    expect((await post(`${second}/dismiss`)).body).toEqual({ unreadCount: 2 });
    expect((await list()).items.map((item) => item.id)).not.toContain(second);
    expect((await post(`${second}/restore`)).body).toEqual({ unreadCount: 3 });
    const until = new Date(b.now() + HOUR).toISOString();
    expect((await post(`${third}/snooze`, { until })).body).toEqual({ unreadCount: 2 });
    expect((await list()).items.map((item) => item.id)).not.toContain(third);
    const past = await post(`${third}/snooze`, { until: new Date(b.now() - HOUR).toISOString() });
    expect(past.status).toBe(400);
    expect((past.body as { code: string }).code).toBe('NOTIFICATION_SNOOZE_INVALID');
    const all = await call(b.server, 'POST', '/api/v1/notifications/read-all', { as: b.h.alice });
    expect(all.body).toEqual({ unreadCount: 0 });
    const count = await call(b.server, 'GET', '/api/v1/notifications/unread-count', {
      as: b.h.alice,
    });
    expect(count.body).toEqual({ unreadCount: 0 });
  });
});

describe('preferences', () => {
  it('default to the registry, save, and take effect on the next emit', async () => {
    const path = '/api/v1/me/notification-preferences';
    const before = (await call(b.server, 'GET', path, { as: b.h.bob }))
      .body as unknown as NotificationPreferences;
    expect(before.preferences.every((preference) => preference.isDefault)).toBe(true);
    const saved = await call(b.server, 'PUT', path, {
      as: b.h.bob,
      body: {
        preferences: [
          { type: 'SYSTEM', isEnabled: false, toastEnabled: false },
          {
            type: 'TASK_DUE',
            isEnabled: true,
            thresholds: { days: [14, 2], dueDay: true, overdue: false },
            toastEnabled: false,
          },
        ],
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const after = (saved.body as unknown as NotificationPreferences).preferences;
    expect(after.find((p) => p.type === 'TASK_DUE')).toMatchObject({
      isDefault: false,
      thresholds: { days: [14, 2] },
    });
    expect(
      b.engine.emit({
        type: 'SYSTEM',
        recipients: [b.h.bob.id],
        title: 'x',
        body: '',
        route: null,
        dedupeKey: 'bob-x',
      }),
    ).toEqual([]);
  });
});

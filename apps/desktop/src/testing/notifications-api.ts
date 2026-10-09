import {
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationPreference,
} from '@compintel/contracts';
import { vi } from 'vitest';

/**
 * The WP-23 backend for its screens, in memory (D-33): one person's
 * notifications with read, snooze, dismiss, restore and read-all, the unread
 * count, and preferences. Everything else goes to the fake installed before it.
 */

export interface NotificationsApi {
  readonly rows: Notification[];
  readonly dismissed: Set<string>;
  readonly calls: { method: string; path: string; body: unknown }[];
  /** A notification arrives (the stream's job in the app; tests call this). */
  add(row: Notification): void;
  failList: boolean;
}

let serial = 0;
export function makeNotification(patch: Partial<Notification> = {}): Notification {
  serial += 1;
  return {
    id: `0192f0c1-0000-7000-8000-${String(serial).padStart(12, '0')}`,
    type: 'TASK_DUE',
    severity: 'INFO',
    title: `Reminder ${String(serial)} is due in 3 days`,
    body: 'Team Rocket — Synthetic Hack',
    subjectKind: 'TASK',
    subjectId: `task:${String(serial)}`,
    route: '/competitions/0192f0c1-0000-7000-8000-00000000e001',
    dueAt: '2026-10-12T00:00:00.000Z',
    precision: 'DATE',
    createdAt: '2026-10-09T04:00:00.000Z',
    readAt: null,
    snoozedUntil: null,
    toast: false,
    ...patch,
  };
}

const respond = (status: number, body: unknown): Response =>
  ({
    ok: status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

const DEFAULT_PREFERENCES: NotificationPreference[] = NOTIFICATION_TYPES.map((type) => ({
  type,
  isEnabled: true,
  thresholds:
    type.endsWith('_DEADLINE') || type.endsWith('_DUE') || type === 'OVERDUE'
      ? { days: [7, 3, 1], dueDay: true, overdue: true }
      : null,
  toastEnabled: type !== 'SYSTEM',
  isDefault: true,
}));

export function installNotificationsApi(rows: Notification[] = []): NotificationsApi {
  const delegate = globalThis.fetch;
  let preferences = DEFAULT_PREFERENCES;
  const api: NotificationsApi = {
    rows: [...rows],
    dismissed: new Set(),
    calls: [],
    add(row) {
      api.rows.unshift(row);
    },
    failList: false,
  };
  const visible = (): Notification[] =>
    api.rows.filter((row) => !api.dismissed.has(row.id) && row.snoozedUntil === null);
  const unread = (): number => visible().filter((row) => row.readAt === null).length;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      const path = parsed.pathname;
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      if (path === '/api/v1/me/notification-preferences') {
        api.calls.push({ method, path, body });
        if (method === 'PUT') {
          const update = (body as { preferences: NotificationPreference[] }).preferences;
          preferences = preferences.map((row) => {
            const next = update.find((u) => u.type === row.type);
            return next === undefined ? row : { ...row, ...next, isDefault: false };
          });
        }
        return Promise.resolve(respond(200, { preferences }));
      }
      if (!path.startsWith('/api/v1/notifications')) return delegate(url, init);
      api.calls.push({ method, path, body });
      if (path === '/api/v1/notifications') {
        if (api.failList) {
          return Promise.resolve(
            respond(500, {
              type: 'urn:compintel:problem:INTERNAL',
              title: 'Something went wrong',
              status: 500,
              code: 'INTERNAL',
              requestId: 'r',
            }),
          );
        }
        const state = parsed.searchParams.get('state') ?? 'all';
        const limit = Number(parsed.searchParams.get('limit') ?? '30');
        const items = visible()
          .filter((row) => state === 'all' || row.readAt === null)
          .slice(0, limit);
        return Promise.resolve(respond(200, { items, unreadCount: unread(), nextCursor: null }));
      }
      if (path === '/api/v1/notifications/unread-count') {
        return Promise.resolve(respond(200, { unreadCount: unread() }));
      }
      if (path === '/api/v1/notifications/read-all') {
        for (const row of visible()) Object.assign(row, { readAt: '2026-10-09T05:00:00.000Z' });
        return Promise.resolve(respond(200, { unreadCount: 0 }));
      }
      const match = /^\/api\/v1\/notifications\/([^/]+)\/(\w+)$/.exec(path);
      const row = api.rows.find((r) => r.id === match?.[1]);
      if (match === null || row === undefined) {
        return Promise.resolve(respond(404, { code: 'NOTIFICATION_NOT_FOUND', status: 404 }));
      }
      const action = match[2];
      if (action === 'read') Object.assign(row, { readAt: '2026-10-09T05:00:00.000Z' });
      if (action === 'unread') Object.assign(row, { readAt: null });
      if (action === 'dismiss') api.dismissed.add(row.id);
      if (action === 'restore') api.dismissed.delete(row.id);
      if (action === 'snooze')
        Object.assign(row, { snoozedUntil: (body as { until: string }).until });
      return Promise.resolve(respond(200, { unreadCount: unread() }));
    }),
  );
  return api;
}

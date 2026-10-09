import {
  NotificationList,
  NotificationPreferences,
  UnreadCount,
  type BackendConnection,
  type NotificationPreferenceUpdate,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/** `/api/v1/notifications` and `/api/v1/me/notification-preferences` (WP-23), parsed. */

export const NOTIFICATIONS_KEY = ['notifications'] as const;
export const UNREAD_COUNT_KEY = ['notifications', 'unread-count'] as const;
export const PREFERENCES_KEY = ['notifications', 'preferences'] as const;

export type NotificationAction = 'read' | 'unread' | 'dismiss' | 'restore';

export async function listNotifications(
  connection: BackendConnection,
  query: { readonly state: 'unread' | 'all'; readonly cursor?: string; readonly limit?: number },
): Promise<NotificationList> {
  const params = new URLSearchParams({ state: query.state, limit: String(query.limit ?? 30) });
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  return NotificationList.parse(
    await apiGet(connection, `/api/v1/notifications?${params.toString()}`),
  );
}

export async function getUnreadCount(connection: BackendConnection): Promise<UnreadCount> {
  return UnreadCount.parse(await apiGet(connection, '/api/v1/notifications/unread-count'));
}

export async function actOnNotification(
  connection: BackendConnection,
  id: string,
  action: NotificationAction,
): Promise<UnreadCount> {
  return UnreadCount.parse(
    await apiRequest(connection, `/api/v1/notifications/${id}/${action}`, { method: 'POST' }),
  );
}

export async function snoozeNotification(
  connection: BackendConnection,
  id: string,
  until: string,
): Promise<UnreadCount> {
  return UnreadCount.parse(
    await apiRequest(connection, `/api/v1/notifications/${id}/snooze`, {
      method: 'POST',
      body: { until },
    }),
  );
}

export async function readAllNotifications(connection: BackendConnection): Promise<UnreadCount> {
  return UnreadCount.parse(
    await apiRequest(connection, '/api/v1/notifications/read-all', { method: 'POST' }),
  );
}

export async function getPreferences(
  connection: BackendConnection,
): Promise<NotificationPreferences> {
  return NotificationPreferences.parse(
    await apiGet(connection, '/api/v1/me/notification-preferences'),
  );
}

export async function savePreferences(
  connection: BackendConnection,
  update: NotificationPreferenceUpdate,
): Promise<NotificationPreferences> {
  return NotificationPreferences.parse(
    await apiRequest(connection, '/api/v1/me/notification-preferences', {
      method: 'PUT',
      body: update,
    }),
  );
}

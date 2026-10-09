import {
  NotificationList,
  NotificationPreferenceUpdate,
  NotificationPreferences,
  NotificationQuery,
  SnoozeRequest,
  UnreadCount,
  Uuid7,
} from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { NotificationsModule } from '../modules/notifications/wiring.js';
import { requireSession } from '../platform/authn.js';

/**
 * The inbox (WP-23, R108–R111): a person's own notifications and preferences.
 * Every route is signed-in and personal; nothing here is audited (R84).
 */

export interface NotificationsRouteOptions {
  readonly notifications: () => NotificationsModule | undefined;
}

const Params = z.object({ id: Uuid7 });
const ACTIONS = ['read', 'unread', 'dismiss', 'restore'] as const;

export const notificationsRoutes =
  (options: NotificationsRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const inbox = () => {
      const module = options.notifications();
      if (module === undefined) throw new Error('notifications are not available on this backend');
      return module.inbox;
    };

    app.get(
      '/notifications',
      { schema: { querystring: NotificationQuery, response: { 200: NotificationList } } },
      (r) => inbox().list(requireSession(r).user.id, r.query),
    );
    app.get('/notifications/unread-count', { schema: { response: { 200: UnreadCount } } }, (r) => ({
      unreadCount: inbox().unreadCount(requireSession(r).user.id),
    }));
    app.post('/notifications/read-all', { schema: { response: { 200: UnreadCount } } }, (r) => {
      const userId = requireSession(r).user.id;
      inbox().readAll(userId);
      return { unreadCount: inbox().unreadCount(userId) };
    });
    for (const action of ACTIONS) {
      app.post(
        `/notifications/:id/${action}`,
        { schema: { params: Params, response: { 200: UnreadCount } } },
        (r) => {
          const userId = requireSession(r).user.id;
          const service = inbox();
          if (action === 'read') service.markRead(userId, r.params.id);
          else if (action === 'unread') service.markUnread(userId, r.params.id);
          else if (action === 'dismiss') service.dismiss(userId, r.params.id);
          else service.restore(userId, r.params.id);
          return { unreadCount: service.unreadCount(userId) };
        },
      );
    }
    app.post(
      '/notifications/:id/snooze',
      { schema: { params: Params, body: SnoozeRequest, response: { 200: UnreadCount } } },
      (r) => {
        const userId = requireSession(r).user.id;
        inbox().snooze(userId, r.params.id, r.body.until);
        return { unreadCount: inbox().unreadCount(userId) };
      },
    );
    app.get(
      '/me/notification-preferences',
      { schema: { response: { 200: NotificationPreferences } } },
      (r) => inbox().preferences(requireSession(r).user.id),
    );
    app.put(
      '/me/notification-preferences',
      {
        schema: { body: NotificationPreferenceUpdate, response: { 200: NotificationPreferences } },
      },
      (r) => inbox().savePreferences(requireSession(r).user.id, r.body),
    );
    done();
  };

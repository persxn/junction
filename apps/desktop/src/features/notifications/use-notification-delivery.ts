import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { notifyCritical, onToastNavigate, setTrayUnread } from '../../shell/tray.js';
import { useLatestNotifications, useUnreadCount } from './use-notifications.js';

/**
 * What reaches outside the window (R90, R24, WP-23): the tray badge follows the
 * unread count, and each new notification that asks for a toast — CRITICAL,
 * with the person's toast preference on — is handed to the shell once. The
 * first load only remembers what is already there: nothing old pops up at
 * sign-in. A clicked toast navigates, if its route is one of ours.
 */
export function useNotificationDelivery(): void {
  const navigate = useNavigate();
  const count = useUnreadCount().data?.unreadCount;
  const latest = useLatestNotifications().data?.items;
  const seen = useRef<Set<string> | undefined>(undefined);

  useEffect(() => {
    if (count !== undefined) void setTrayUnread(count).catch(() => undefined);
  }, [count]);

  useEffect(() => {
    if (latest === undefined) return;
    if (seen.current === undefined) {
      seen.current = new Set(latest.map((item) => item.id));
      return;
    }
    for (const item of latest) {
      if (seen.current.has(item.id)) continue;
      seen.current.add(item.id);
      if (item.toast && item.readAt === null && item.route !== null) {
        void notifyCritical({
          id: item.id,
          title: item.title,
          body: item.body,
          route: item.route,
        }).catch(() => undefined);
      }
    }
  }, [latest]);

  useEffect(
    () =>
      onToastNavigate((route) => {
        void navigate({ to: route });
      }),
    [navigate],
  );
}

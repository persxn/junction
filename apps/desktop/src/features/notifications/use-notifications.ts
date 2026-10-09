import type { Notification } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { createContext, useContext } from 'react';

import {
  actOnNotification,
  getUnreadCount,
  listNotifications,
  NOTIFICATIONS_KEY,
  readAllNotifications,
  snoozeNotification,
  UNREAD_COUNT_KEY,
  type NotificationAction,
} from '../../api/notifications.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { isInternalRoute } from './notification-model.js';

/**
 * The inbox's queries and actions (WP-23). Every action re-reads the
 * notifications; the stream does the same for the person's other windows.
 */

/** True while live updates are off (R30): the badge then re-checks every minute. */
export const LiveDegradedContext = createContext(false);
export const useLiveDegraded = (): boolean => useContext(LiveDegradedContext);

export const DEGRADED_POLL_MS = 60_000;

export function useUnreadCount() {
  const connection = useBackendConnection();
  const degraded = useLiveDegraded();
  return useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: () => getUnreadCount(connection),
    refetchInterval: degraded ? DEGRADED_POLL_MS : false,
  });
}

export function useLatestNotifications(limit = 5) {
  const connection = useBackendConnection();
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, 'latest', limit],
    queryFn: () => listNotifications(connection, { state: 'all', limit }),
  });
}

export interface NotificationActions {
  readonly act: (notification: Notification, action: NotificationAction) => void;
  readonly snooze: (notification: Notification, until: number) => void;
  readonly open: (notification: Notification) => void;
  readonly readAll: () => void;
}

export function useNotificationActions(): NotificationActions {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  };
  const failed = (error: unknown): void => {
    toast.show({ tone: 'danger', title: 'That did not work', description: problemText(error) });
  };
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: NotificationAction }) =>
      actOnNotification(connection, id, action),
    onSuccess: refresh,
    onError: failed,
  });
  const snooze = useMutation({
    mutationFn: ({ id, until }: { id: string; until: number }) =>
      snoozeNotification(connection, id, new Date(until).toISOString()),
    onSuccess: refresh,
    onError: failed,
  });
  const readAll = useMutation({
    mutationFn: () => readAllNotifications(connection),
    onSuccess: refresh,
    onError: failed,
  });
  return {
    act: (notification, action) => {
      act.mutate(
        { id: notification.id, action },
        action === 'dismiss'
          ? {
              onSuccess: () => {
                toast.show({
                  title: 'Notification dismissed',
                  action: {
                    label: 'Undo',
                    onAction: () => {
                      act.mutate({ id: notification.id, action: 'restore' });
                    },
                  },
                });
              },
            }
          : undefined,
      );
    },
    snooze: (notification, until) => {
      snooze.mutate(
        { id: notification.id, until },
        {
          onSuccess: () => {
            toast.show({
              title: 'Snoozed',
              description: 'It comes back within five minutes of the time you chose.',
            });
          },
        },
      );
    },
    open: (notification) => {
      if (notification.readAt === null) act.mutate({ id: notification.id, action: 'read' });
      if (isInternalRoute(notification.route)) void navigate({ to: notification.route });
    },
    readAll: () => {
      readAll.mutate();
    },
  };
}

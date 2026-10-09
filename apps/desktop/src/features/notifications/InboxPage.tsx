import type { NotificationList } from '@compintel/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { BellOff, CheckCheck } from 'lucide-react';
import { useId, useState } from 'react';

import { listNotifications, NOTIFICATIONS_KEY } from '../../api/notifications.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useNow } from '../../lib/use-now.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { NotificationItem } from './NotificationItem.js';
import { PreferencesPanel } from './PreferencesPanel.js';
import { unreadLabel } from './notification-model.js';
import { useLiveDegraded, useNotificationActions } from './use-notifications.js';

/**
 * The Inbox (§12, WP-23, R108–R111): Unread or All, newest first; open, read or
 * unread, snooze, dismiss with Undo; and the per-type preferences. Snoozed and
 * dismissed notifications are not listed.
 */

const TABS = [
  { state: 'unread', label: 'Unread' },
  { state: 'all', label: 'All' },
] as const;

export function InboxPage(): React.JSX.Element {
  const connection = useBackendConnection();
  const [state, setState] = useState<'unread' | 'all'>('unread');
  const [settings, setSettings] = useState(false);
  const id = useId();
  const now = useNow();
  const actions = useNotificationActions();
  const degraded = useLiveDegraded();
  const list = useInfiniteQuery({
    queryKey: [...NOTIFICATIONS_KEY, 'inbox', state],
    queryFn: ({ pageParam }) =>
      listNotifications(connection, {
        state,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: NotificationList) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = list.data?.pages[0]?.unreadCount;

  let body: React.JSX.Element;
  if (list.isPending) body = <Skeleton lines={5} label="Loading notifications" />;
  else if (list.isError) {
    body = (
      <EmptyState
        icon={BellOff}
        title="The notifications could not be loaded"
        description={problemText(list.error)}
        action={{ label: 'Try again', onAction: () => void list.refetch() }}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={CheckCheck}
        title="You’re all caught up"
        description={
          state === 'unread'
            ? 'Nothing unread. Deadline reminders and changes to saved events arrive here.'
            : 'No notifications yet. Deadline reminders and changes to saved events arrive here.'
        }
        action={
          state === 'unread'
            ? {
                label: 'Show all',
                onAction: () => {
                  setState('all');
                },
              }
            : {
                label: 'Notification settings',
                onAction: () => {
                  setSettings(true);
                },
              }
        }
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1.5" aria-label="Notifications">
          {items.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              now={now}
              actions={actions}
            />
          ))}
        </ul>
        {list.hasNextPage && (
          <button
            type="button"
            onClick={() => void list.fetchNextPage()}
            className="w-fit rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Show more
          </button>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <div>
        <h1 id={`${id}-heading`} className="font-display text-xl">
          Notifications
        </h1>
        <p className="text-fg-muted">
          {unread === undefined ? 'Your reminders and alerts.' : unreadLabel(unread)}
        </p>
        {degraded && (
          <p className="text-sm text-warning">
            Live updates unavailable — re-checking every minute.
          </p>
        )}
      </div>
      <Guide id="notifications-inbox" title="What arrives here">
        <p>
          Reminders <strong>7, 3 and 1 days</strong> before, on the <strong>due day</strong> and
          when our own work is <strong>overdue</strong> — for competitions you mentor and events you
          saved — plus deadline changes and cancellations of events you watch. Each reminder comes
          once.
        </p>
        <p>
          Urgent ones also appear as a Windows notification, even with the window closed to the
          tray. Snoozed ones come back within five minutes of the time you chose. Turn types off,
          change the days or stop the Windows notifications in{' '}
          <strong>Notification settings</strong>.
        </p>
      </Guide>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show" className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.state}
              type="button"
              aria-pressed={state === tab.state}
              onClick={() => {
                setState(tab.state);
              }}
              className="rounded-md border border-line px-3 py-1 text-sm aria-pressed:border-accent aria-pressed:text-accent"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={actions.readAll}
          disabled={unread === 0}
          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-surface-hover disabled:opacity-50"
        >
          Mark all read
        </button>
        <button
          type="button"
          aria-expanded={settings}
          onClick={() => {
            setSettings((value) => !value);
          }}
          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-surface-hover"
        >
          Notification settings
        </button>
      </div>
      {settings && <PreferencesPanel />}
      {body}
    </section>
  );
}

import type { Notification } from '@compintel/contracts';
import { Check, Mail, X } from 'lucide-react';

import { ago } from '../../lib/ago.js';
import { SnoozeMenu } from './SnoozeMenu.js';
import { dueLine, SEVERITY_ICON, SEVERITY_TONE, severityText } from './notification-model.js';
import type { NotificationActions } from './use-notifications.js';

/**
 * One notification (WP-23): severity icon and word, title (the link that opens
 * it and marks it read), body, due line with its precision, relative time; the
 * full row adds read/unread, snooze and dismiss. `compact` is the bell's and
 * the Dashboard's version: open only.
 */
export function NotificationItem({
  notification,
  now,
  actions,
  compact = false,
}: {
  readonly notification: Notification;
  readonly now: number;
  readonly actions: NotificationActions;
  readonly compact?: boolean;
}): React.JSX.Element {
  const Icon = SEVERITY_ICON[notification.severity];
  const unread = notification.readAt === null;
  const due = dueLine(notification);
  return (
    <li
      data-testid="notification"
      className={`flex items-start gap-2 rounded-md border border-line p-2 ${unread ? 'bg-surface-raised' : 'bg-surface'}`}
    >
      <span
        className={`flex shrink-0 items-center gap-1 text-xs ${SEVERITY_TONE[notification.severity]}`}
      >
        <Icon aria-hidden="true" className="size-4" />
        {severityText(notification.severity)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <button
          type="button"
          onClick={() => {
            actions.open(notification);
          }}
          className={`text-left text-sm hover:underline ${unread ? 'font-medium' : ''}`}
        >
          {unread && <span className="sr-only">Unread: </span>}
          {notification.title}
        </button>
        {!compact && notification.body !== '' && (
          <span className="text-sm text-fg-muted">{notification.body}</span>
        )}
        <span className="text-xs text-fg-muted">
          {due === undefined ? '' : `${due} · `}
          {ago(Date.parse(notification.createdAt), now)}
        </span>
      </div>
      {!compact && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`${unread ? 'Mark read' : 'Mark unread'}: ${notification.title}`}
            onClick={() => {
              actions.act(notification, unread ? 'read' : 'unread');
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-surface-hover"
          >
            {unread ? (
              <Check aria-hidden="true" className="size-3.5" />
            ) : (
              <Mail aria-hidden="true" className="size-3.5" />
            )}
            {unread ? 'Mark read' : 'Mark unread'}
          </button>
          <SnoozeMenu
            notification={notification}
            now={now}
            onSnooze={(until) => {
              actions.snooze(notification, until);
            }}
          />
          <button
            type="button"
            aria-label={`Dismiss: ${notification.title}`}
            onClick={() => {
              actions.act(notification, 'dismiss');
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-surface-hover"
          >
            <X aria-hidden="true" className="size-3.5" />
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}

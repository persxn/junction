import { Link } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { useNow } from '../../lib/use-now.js';
import { NotificationItem } from './NotificationItem.js';
import { badgeText, unreadLabel } from './notification-model.js';
import {
  useLatestNotifications,
  useLiveDegraded,
  useNotificationActions,
  useUnreadCount,
} from './use-notifications.js';

/**
 * The top bar's bell (WP-23): an icon and a number, named "3 unread
 * notifications"; it opens the latest five with a way to the Inbox.
 */
export function NotificationBell({
  defaultOpen = false,
}: {
  /** Test seam: start open so axe sees the popover. */
  readonly defaultOpen?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const now = useNow();
  const count = useUnreadCount().data?.unreadCount ?? 0;
  const latest = useLatestNotifications();
  const actions = useNotificationActions();
  const degraded = useLiveDegraded();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const close = (): void => {
    setOpen(false);
  };
  const items = latest.data?.items ?? [];

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        close();
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={unreadLabel(count)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        data-testid="notification-bell"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex items-center gap-1 rounded-md p-2 text-fg-muted hover:bg-surface-hover"
      >
        <Bell aria-hidden="true" className="size-4" />
        {count > 0 && (
          <span aria-hidden="true" className="rounded-full bg-accent px-1.5 text-xs text-on-accent">
            {badgeText(count)}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Latest notifications"
          className="absolute right-0 z-30 mt-1 flex w-96 flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3 shadow-[var(--ci-shadow-popover)]"
        >
          <h2 className="text-sm font-medium">{unreadLabel(count)}</h2>
          {degraded && (
            <p className="text-xs text-warning">
              Live updates unavailable — re-checking every minute.
            </p>
          )}
          {latest.isPending ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : latest.isError ? (
            <p className="text-sm text-danger">The notifications could not be loaded.</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-fg-muted">You’re all caught up.</p>
          ) : (
            <ul className="flex flex-col gap-1.5" onClick={close}>
              {items.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  now={now}
                  actions={actions}
                  compact
                />
              ))}
            </ul>
          )}
          <Link to="/notifications" onClick={close} className="text-sm text-accent hover:underline">
            Open the Inbox
          </Link>
        </div>
      )}
    </div>
  );
}

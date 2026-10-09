import type { KpiScope } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { listCompetitions } from '../../api/competitions.js';
import { listDeadlines } from '../../api/deadlines.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useNow } from '../../lib/use-now.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { whoOf } from '../competitions/board-model.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { DeadlineRow } from '../deadlines/DeadlineRow.js';
import { DEFAULT_DEADLINES_SEARCH } from '../deadlines/deadline-model.js';
import { ProgressHealth } from '../workflows/ProgressHealth.js';

/**
 * The Dashboard's own panels (§16.2, WP-22). Each loads, fails and empties on
 * its own, so one slow or broken source never blanks the page.
 */

export function Panel({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-md">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PanelError({
  what,
  error,
  retry,
}: {
  readonly what: string;
  readonly error: unknown;
  readonly retry: () => void;
}): React.JSX.Element {
  return (
    <p
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-md bg-danger-surface p-2 text-sm"
    >
      {what} did not load: {problemText(error)}
      <button
        type="button"
        onClick={retry}
        className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-surface-hover"
      >
        Try again
      </button>
    </p>
  );
}

/** Radar, top 8: soonest first, so the overdue and today buckets lead. */
export function RadarPanel({ scope }: { readonly scope: KpiScope }): React.JSX.Element {
  const connection = useBackendConnection();
  const now = useNow();
  const radar = useQuery({
    queryKey: ['deadlines', { scope, limit: 8 }],
    queryFn: () => listDeadlines(connection, { scope, limit: 8 }),
  });
  let body: ReactNode;
  if (radar.isPending) body = <Skeleton lines={4} label="Loading deadlines" />;
  else if (radar.isError)
    body = (
      <PanelError what="The deadlines" error={radar.error} retry={() => void radar.refetch()} />
    );
  else if (radar.data.items.length === 0) {
    body = (
      <p className="text-sm text-fg-muted">
        Nothing due — saved events and competitions show their deadlines here.
      </p>
    );
  } else {
    body = (
      <ul aria-label="Next deadlines" className="flex flex-col gap-1.5">
        {radar.data.items.map((item) => (
          <DeadlineRow key={item.id} item={item} now={now} />
        ))}
      </ul>
    );
  }
  return (
    <Panel
      title="Deadline Radar"
      action={
        <Link
          to="/deadlines"
          search={{ ...DEFAULT_DEADLINES_SEARCH, scope }}
          className="text-sm hover:underline"
        >
          View all
        </Link>
      }
    >
      {body}
    </Panel>
  );
}

/** Active competitions with WP-20a's progress and health, its reason in words. */
export function ActivePanel({ scope }: { readonly scope: KpiScope }): React.JSX.Element {
  const connection = useBackendConnection();
  const query = {
    status: ['ASSIGNED', 'APPLIED', 'PARTICIPATING'] as (
      'ASSIGNED' | 'APPLIED' | 'PARTICIPATING'
    )[],
    ...(scope === 'MINE' ? { mentorId: 'me' as const } : {}),
  };
  const active = useQuery({
    queryKey: ['competitions', 'list', query],
    queryFn: () => listCompetitions(connection, query),
  });
  let body: ReactNode;
  if (active.isPending) body = <Skeleton lines={4} label="Loading active competitions" />;
  else if (active.isError)
    body = (
      <PanelError
        what="Active competitions"
        error={active.error}
        retry={() => void active.refetch()}
      />
    );
  else if (active.data.items.length === 0) {
    body = (
      <p className="text-sm text-fg-muted">
        No active competitions. Assign an event from{' '}
        <Link
          to="/discover"
          search={{ tab: 'featured', view: 'recommended', filters: {} }}
          className="text-fg underline"
        >
          Discover
        </Link>
        .
      </p>
    );
  } else {
    body = (
      <ul aria-label="Active competitions" className="flex flex-col gap-1.5">
        {active.data.items.slice(0, 6).map((item) => (
          <li key={item.id} className="flex flex-col gap-0.5 text-sm">
            <Link
              to="/competitions/$competitionId"
              params={{ competitionId: item.id }}
              className="font-medium hover:underline"
            >
              {whoOf(item)} — {item.event.title}
            </Link>
            <ProgressHealth item={item} />
            {item.healthReason !== null && (
              <span className="text-xs text-fg-muted">{item.healthReason}</span>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return <Panel title="Active teams">{body}</Panel>;
}

/** WP-23 replaces this card with the inbox. */
export function NotificationsPanel(): React.JSX.Element {
  return (
    <Panel title="Recent notifications">
      <p className="text-sm text-fg-muted">
        No notifications yet. Deadline reminders and changes to saved events will appear here.
      </p>
    </Panel>
  );
}

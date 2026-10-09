import {
  DEADLINE_GROUP_LABELS,
  DEADLINE_SCOPES,
  DEADLINE_SCOPE_LABELS,
  DUE_ITEM_KIND_LABELS,
  URGENCY_BUCKETS,
  URGENCY_BUCKET_LABELS,
  type DeadlineListResponse,
  type DueItem,
} from '@compintel/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { CalendarCheck, X } from 'lucide-react';
import { useId } from 'react';

import { listDeadlines } from '../../api/deadlines.js';
import { listTeams } from '../../api/teams.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { formatCount } from '../../lib/count.js';
import { useNow } from '../../lib/use-now.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { DEFAULT_SEARCH } from '../discover/search-state.js';
import { DeadlineRow } from './DeadlineRow.js';
import { parseDeadlinesSearch, toDeadlineQuery, type DeadlinesSearch } from './deadline-model.js';

/**
 * The Deadline Radar (§12, §16.2, R106–R107, WP-22): everything due, grouped by
 * urgency — each item in exactly one group, the count beside each heading the
 * server's — filtered by scope, team, and event deadlines versus our work.
 */

const FIELD = 'rounded-md border border-line bg-surface px-2 py-1 text-sm';

export function DeadlinesPage(): React.JSX.Element {
  const connection = useBackendConnection();
  const navigate = useNavigate();
  const search = parseDeadlinesSearch(useSearch({ strict: false }));
  const now = useNow();
  const id = useId();
  const query = toDeadlineQuery(search);
  const update = (next: Partial<DeadlinesSearch>): void => {
    void navigate({ to: '/deadlines', search: { ...search, ...next } });
  };
  const teams = useQuery({
    queryKey: ['teams', 'list', { status: 'ACTIVE' }],
    queryFn: () => listTeams(connection, { status: 'ACTIVE' }),
    enabled: search.scope === 'TEAM',
  });
  const list = useInfiniteQuery({
    queryKey: ['deadlines', query],
    queryFn: ({ pageParam }) =>
      listDeadlines(connection, {
        ...query,
        limit: 100,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: DeadlineListResponse) => last.nextCursor ?? undefined,
  });
  const first = list.data?.pages[0];
  const items: DueItem[] = list.data?.pages.flatMap((page) => page.items) ?? [];

  let body: React.JSX.Element;
  if (list.isPending) body = <Skeleton lines={6} label="Loading deadlines" />;
  else if (list.isError) {
    body = (
      <EmptyState
        icon={CalendarCheck}
        title="The deadlines could not be loaded"
        description={problemText(list.error)}
        action={{ label: 'Try again', onAction: () => void list.refetch() }}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={CalendarCheck}
        title="Nothing due"
        description="Nothing due — saved events and competitions show their deadlines here."
        action={{
          label: 'Go to Discover',
          onAction: () => void navigate({ to: '/discover', search: DEFAULT_SEARCH }),
        }}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {URGENCY_BUCKETS.filter((bucket) => items.some((item) => item.bucket === bucket)).map(
          (bucket) => (
            <section
              key={bucket}
              aria-labelledby={`${id}-${bucket}`}
              className="flex flex-col gap-1.5"
            >
              <h2 id={`${id}-${bucket}`} className="text-md">
                {URGENCY_BUCKET_LABELS[bucket]} ({formatCount(first?.counts[bucket] ?? 0)})
              </h2>
              <ul className="flex flex-col gap-1.5">
                {items
                  .filter((item) => item.bucket === bucket)
                  .map((item) => (
                    <DeadlineRow key={item.id} item={item} now={now} />
                  ))}
              </ul>
            </section>
          ),
        )}
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
          Deadline Radar
        </h1>
        <p className="text-fg-muted">
          {first === undefined
            ? 'What falls due, soonest first.'
            : `${formatCount(first.total)} due`}
        </p>
      </div>
      <Guide id="deadline-radar" title="What the Radar shows">
        <p>
          Deadlines of events you <strong>saved</strong> or that a competition is entered for, and
          the due dates of <strong>stages and tasks</strong> in active competitions. Each sits in
          exactly one group: Overdue, Today, the next 3 days, the next 7 days, or Later — counted in
          Indian time.
        </p>
        <p>
          An event’s own deadline leaves once it has passed; only our own work is ever overdue. A
          date the source gave without a time reads “(time not stated)”.
        </p>
      </Guide>
      <div className="flex flex-wrap items-end gap-3">
        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
          <legend className="sr-only">Whose deadlines</legend>
          {DEADLINE_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`${id}-scope`}
                checked={search.scope === scope}
                onChange={() => {
                  update({ scope });
                }}
              />
              {DEADLINE_SCOPE_LABELS[scope]}
            </label>
          ))}
        </fieldset>
        {search.scope === 'TEAM' && (
          <label htmlFor={`${id}-team`} className="flex items-center gap-1.5 text-sm">
            Team
            <select
              id={`${id}-team`}
              value={search.teamId ?? ''}
              onChange={(e) => {
                update({ teamId: e.target.value === '' ? undefined : e.target.value });
              }}
              className={FIELD}
            >
              <option value="">Choose a team</option>
              {(teams.data?.items ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor={`${id}-group`} className="flex items-center gap-1.5 text-sm">
          Show
          <select
            id={`${id}-group`}
            value={search.group ?? ''}
            onChange={(e) => {
              update({
                group:
                  e.target.value === '' ? undefined : (e.target.value as DeadlinesSearch['group']),
              });
            }}
            className={FIELD}
          >
            <option value="">Everything</option>
            <option value="EVENTS">{DEADLINE_GROUP_LABELS.EVENTS}</option>
            <option value="WORK">{DEADLINE_GROUP_LABELS.WORK}</option>
          </select>
        </label>
        {search.bucket !== undefined && (
          <button
            type="button"
            onClick={() => {
              update({ bucket: undefined });
            }}
            className="flex items-center gap-1 rounded-full border border-accent px-2 py-0.5 text-sm"
            aria-label={`Remove filter: ${URGENCY_BUCKET_LABELS[search.bucket]} only`}
          >
            {URGENCY_BUCKET_LABELS[search.bucket]} only
            <X aria-hidden="true" className="size-3.5" />
          </button>
        )}
        {search.itemKind !== undefined && (
          <button
            type="button"
            onClick={() => {
              update({ itemKind: undefined });
            }}
            className="flex items-center gap-1 rounded-full border border-accent px-2 py-0.5 text-sm"
            aria-label={`Remove filter: ${DUE_ITEM_KIND_LABELS[search.itemKind]}s only`}
          >
            {DUE_ITEM_KIND_LABELS[search.itemKind]}s only
            <X aria-hidden="true" className="size-3.5" />
          </button>
        )}
      </div>
      {search.scope === 'TEAM' && search.teamId === undefined ? (
        <p className="text-sm text-fg-muted">Choose a team to see its deadlines.</p>
      ) : (
        body
      )}
    </section>
  );
}

import {
  TEAM_STATUS_LABELS,
  TEAM_STATUSES,
  type TeamListQuery,
  type TeamStatus,
} from '@compintel/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Search, UserCheck, UsersRound, UserPlus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { listTeams } from '../../api/teams.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { TeamTable } from './TeamTable.js';
import { TEAM_LIST_KEY } from './use-team-actions.js';

/**
 * Teams (§16.1 rail item, §16.2, WP-18 step 6): every team of the department,
 * searchable, filtered by status and "My teams"; J/K/Enter to move and open.
 */

interface Filters {
  readonly text: string;
  /** `''` is "any status". */
  readonly status: TeamStatus | '';
  readonly mine: boolean;
}

const DEFAULT_FILTERS: Filters = { text: '', status: 'ACTIVE', mine: false };

const isDefault = (filters: Filters): boolean =>
  filters.text === '' && filters.status === 'ACTIVE' && !filters.mine;

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
}

function toQuery(filters: Filters): TeamListQuery {
  return {
    ...(filters.text.trim() === '' ? {} : { text: filters.text.trim() }),
    ...(filters.status === '' ? {} : { status: filters.status }),
    ...(filters.mine ? { mentor: 'me' as const } : {}),
  };
}

function Chip(props: {
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      onClick={props.onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm ${
        props.pressed
          ? 'border-accent bg-accent-surface font-medium text-fg'
          : 'border-line text-fg-muted hover:bg-surface-hover'
      }`}
    >
      {props.children}
    </button>
  );
}

export function TeamsPage(): React.JSX.Element {
  const connection = useBackendConnection();
  const navigate = useNavigate();
  const searchId = useId();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const settled = useDebounced(filters, 250);
  const query = useMemo(() => toQuery(settled), [settled]);
  const list = useQuery({
    queryKey: [...TEAM_LIST_KEY, query],
    queryFn: () => listTeams(connection, query),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const set = (patch: Partial<Filters>): void => {
    setFilters({ ...filters, ...patch });
  };

  return (
    <section aria-labelledby="teams-heading" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="teams-heading" className="font-display text-xl">
            Teams
          </h1>
          <p className="text-fg-muted">
            {list.data === undefined
              ? 'Every team of the department, with its members, mentors and skills.'
              : `${String(list.data.total)} ${list.data.total === 1 ? 'team' : 'teams'}${isDefault(settled) ? '' : ' match these filters'}.`}
          </p>
        </div>
        <Link
          to="/teams/new"
          className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover"
        >
          <UserPlus aria-hidden="true" className="size-4" />
          Create a team
        </Link>
      </header>

      <Guide id="teams-list" title="How the team list works">
        <p>
          Every professor sees every team. <strong>My teams</strong> shows the ones you mentor, as
          primary mentor or co-mentor. Archived teams are hidden until you pick{' '}
          <strong>Archived</strong> or <strong>Any status</strong>.
        </p>
        <p>
          <strong>Skill coverage</strong> counts the skills the team has well covered, thinly
          covered, or missing. Press <kbd>J</kbd> and <kbd>K</kbd> to move through the list and{' '}
          <kbd>Enter</kbd> to open a team.
        </p>
      </Guide>

      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter teams">
        <label htmlFor={searchId} className="sr-only">
          Search teams by name
        </label>
        <div className="flex min-w-64 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2">
          <Search aria-hidden="true" className="size-4 text-fg-subtle" />
          <input
            id={searchId}
            type="search"
            value={filters.text}
            placeholder="Search team names"
            onChange={(event) => {
              set({ text: event.target.value });
            }}
            className="w-full bg-transparent py-1.5 text-fg outline-none"
          />
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Status">
          {TEAM_STATUSES.map((status) => (
            <Chip
              key={status}
              pressed={filters.status === status}
              onClick={() => {
                set({ status });
              }}
            >
              {TEAM_STATUS_LABELS[status]}
            </Chip>
          ))}
          <Chip
            pressed={filters.status === ''}
            onClick={() => {
              set({ status: '' });
            }}
          >
            Any status
          </Chip>
        </div>
        <Chip
          pressed={filters.mine}
          onClick={() => {
            set({ mine: !filters.mine });
          }}
        >
          <UserCheck aria-hidden="true" className="size-3.5" />
          My teams
        </Chip>
        {!isDefault(filters) && (
          <button
            type="button"
            onClick={() => {
              setFilters(DEFAULT_FILTERS);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-surface-hover"
          >
            <X aria-hidden="true" className="size-3.5" />
            Clear filters
          </button>
        )}
      </div>

      {list.isPending && <Skeleton lines={6} label="Loading teams" />}

      {list.isError && (
        <EmptyState
          icon={UsersRound}
          title="The team list could not be loaded"
          description={
            isApiProblem(list.error) ? (list.error.detail ?? list.error.title) : String(list.error)
          }
          action={{
            label: 'Try again',
            onAction: () => {
              void list.refetch();
            },
          }}
        />
      )}

      {list.data !== undefined && items.length === 0 && isDefault(settled) && (
        <EmptyState
          icon={UsersRound}
          title="No teams yet"
          description="Create a team, add the students who will compete together, and set the skills it needs."
          action={{
            label: 'Create a team',
            onAction: () => {
              void navigate({ to: '/teams/new' });
            },
          }}
        />
      )}

      {list.data !== undefined && items.length === 0 && !isDefault(settled) && (
        <EmptyState
          icon={UsersRound}
          title="No team matches these filters"
          description="Loosen a filter or clear them all."
          action={{
            label: 'Clear filters',
            onAction: () => {
              setFilters(DEFAULT_FILTERS);
            },
          }}
        />
      )}

      {items.length > 0 && (
        <TeamTable
          items={items}
          keysEnabled
          onOpen={(item) => {
            void navigate({ to: '/teams/$teamId', params: { teamId: item.id } });
          }}
        />
      )}
    </section>
  );
}

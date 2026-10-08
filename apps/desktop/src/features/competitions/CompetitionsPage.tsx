import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Compass, Kanban, List, Trophy } from 'lucide-react';
import { useMemo } from 'react';

import { listCompetitions } from '../../api/competitions.js';
import { isApiProblem } from '../../api/problem.js';
import { listTeams } from '../../api/teams.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useNow } from '../../lib/use-now.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { DEFAULT_SEARCH } from '../discover/search-state.js';
import { CompetitionFilters } from './CompetitionFilters.js';
import { CompetitionTable } from './CompetitionTable.js';
import { PipelineBoard } from './PipelineBoard.js';
import { hasCompetitionFilters, toQuery, type CompetitionsSearch } from './search-state.js';
import { COMPETITIONS_KEY, useCompetitionActions } from './use-competition-actions.js';

/**
 * Competitions (§16.1 rail item, §16.2, WP-19 step 6): the pipeline board or a
 * dense list (`view` in the router state, so the choice survives navigation).
 */

function CompetitionsGuide(): React.JSX.Element {
  return (
    <Guide id="competitions" title="How the pipeline works">
      <p>
        A <strong>competition</strong> is an event a team — or a student on their own — has taken
        on. It moves left to right: Considering, Assigned, Applied, Participating, Completed. It can
        also be <strong>withdrawn</strong>, or <strong>not selected</strong> after applying; those
        two, and Completed, are final.
      </p>
      <p>
        Drag a card to another column, or select it and press <kbd>M</kbd> for{' '}
        <strong>Move to…</strong> — only the moves that are allowed are offered. Arrow keys move
        between cards, <kbd>Enter</kbd> opens one. Assign new events from Discover with the{' '}
        <strong>Assign</strong> button or the <kbd>A</kbd> key.
      </p>
    </Guide>
  );
}

export function CompetitionsPage(): React.JSX.Element {
  const connection = useBackendConnection();
  const navigate = useNavigate();
  const search = useSearch({ from: '/competitions' });
  const now = useNow();
  const actions = useCompetitionActions();
  const query = useMemo(() => toQuery(search), [search]);
  const list = useQuery({
    queryKey: [...COMPETITIONS_KEY, 'list', query],
    queryFn: () => listCompetitions(connection, query),
    placeholderData: keepPreviousData,
  });
  const teams = useQuery({
    queryKey: ['teams', 'list', { status: 'ACTIVE' }],
    queryFn: () => listTeams(connection, { status: 'ACTIVE' }),
  });
  const items = list.data?.items ?? [];
  const update = (next: CompetitionsSearch): void => {
    void navigate({ to: '/competitions', search: next });
  };
  const open = (id: string): void => {
    void navigate({ to: '/competitions/$competitionId', params: { competitionId: id } });
  };

  return (
    <section aria-labelledby="competitions-heading" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="competitions-heading" className="font-display text-xl">
            Competitions
          </h1>
          <p className="text-fg-muted">
            {list.data === undefined
              ? 'Every event a team or student has taken on, from considering to completed.'
              : `${String(list.data.total)} ${list.data.total === 1 ? 'competition' : 'competitions'}${hasCompetitionFilters(search) ? ' match these filters' : ''}.`}
          </p>
        </div>
        <div role="group" aria-label="View" className="flex rounded-md border border-line">
          {(
            [
              ['board', 'Board', Kanban],
              ['list', 'List', List],
            ] as const
          ).map(([view, label, Icon]) => (
            <button
              key={view}
              type="button"
              aria-pressed={search.view === view}
              onClick={() => {
                update({ ...search, view });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm aria-pressed:bg-accent-surface aria-pressed:font-medium"
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <CompetitionsGuide />
      <CompetitionFilters search={search} teams={teams.data?.items ?? []} onChange={update} />

      {list.isPending && <Skeleton lines={6} label="Loading competitions" />}
      {list.isError && (
        <EmptyState
          icon={Trophy}
          title="The competitions could not be loaded"
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
      {list.data !== undefined && items.length === 0 && !hasCompetitionFilters(search) && (
        <EmptyState
          icon={Compass}
          title="No competitions yet"
          description="Find an event on Discover and press Assign (or A) to give it to a team or to students."
          action={{
            label: 'Go to Discover',
            onAction: () => {
              void navigate({ to: '/discover', search: DEFAULT_SEARCH });
            },
          }}
        />
      )}
      {list.data !== undefined && items.length === 0 && hasCompetitionFilters(search) && (
        <EmptyState
          icon={Trophy}
          title="No competition matches these filters"
          description="Loosen a filter or clear them all."
          action={{
            label: 'Clear filters',
            onAction: () => {
              update({
                ...search,
                status: [],
                teamId: undefined,
                mine: false,
                eventTypes: [],
                deadline: undefined,
                closed: false,
              });
            },
          }}
        />
      )}
      {items.length > 0 &&
        (search.view === 'board' ? (
          <PipelineBoard
            items={items}
            now={now}
            onOpen={(item) => {
              open(item.id);
            }}
            onMove={actions.move}
          />
        ) : (
          <CompetitionTable
            items={items}
            now={now}
            onOpen={(item) => {
              open(item.id);
            }}
          />
        ))}
    </section>
  );
}

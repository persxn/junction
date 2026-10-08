import {
  DEADLINE_WINDOWS,
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_STATUS_LABELS,
  EVENT_TYPES,
  type TeamListItem,
} from '@compintel/contracts';
import { UserCheck, X } from 'lucide-react';
import { useId } from 'react';

import { EVENT_TYPE_LABELS } from '../discover/labels.js';
import {
  DEFAULT_COMPETITIONS_SEARCH,
  hasCompetitionFilters,
  type CompetitionsSearch,
} from './search-state.js';

/** The list view's filters (WP-19 step 6): status · team · mine · event type · deadline window · closed. */

const toggle = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

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

export interface CompetitionFiltersProps {
  readonly search: CompetitionsSearch;
  readonly teams: readonly TeamListItem[];
  readonly onChange: (next: CompetitionsSearch) => void;
}

export function CompetitionFilters({
  search,
  teams,
  onChange,
}: CompetitionFiltersProps): React.JSX.Element {
  const teamId = useId();
  const deadlineId = useId();
  const set = (patch: Partial<CompetitionsSearch>): void => {
    onChange({ ...search, ...patch });
  };
  return (
    <div className="flex flex-col gap-2" role="search" aria-label="Filter competitions">
      {search.view === 'list' && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Status">
          <span className="text-sm text-fg-subtle">Status</span>
          {ENGAGEMENT_STATUSES.map((status) => (
            <Chip
              key={status}
              pressed={search.status.includes(status)}
              onClick={() => {
                set({ status: toggle(search.status, status) });
              }}
            >
              {ENGAGEMENT_STATUS_LABELS[status]}
            </Chip>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Event type">
        <span className="text-sm text-fg-subtle">Event type</span>
        {EVENT_TYPES.map((type) => (
          <Chip
            key={type}
            pressed={search.eventTypes.includes(type)}
            onClick={() => {
              set({ eventTypes: toggle(search.eventTypes, type) });
            }}
          >
            {EVENT_TYPE_LABELS[type]}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          pressed={search.mine}
          onClick={() => {
            set({ mine: !search.mine });
          }}
        >
          <UserCheck aria-hidden="true" className="size-3.5" />I mentor
        </Chip>
        <label htmlFor={teamId} className="text-sm text-fg-subtle">
          Team
        </label>
        <select
          id={teamId}
          value={search.teamId ?? ''}
          onChange={(event) => {
            set({ teamId: event.target.value === '' ? undefined : event.target.value });
          }}
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
        >
          <option value="">Any team</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <label htmlFor={deadlineId} className="text-sm text-fg-subtle">
          Next date within
        </label>
        <select
          id={deadlineId}
          value={search.deadline === undefined ? '' : String(search.deadline)}
          onChange={(event) => {
            const days = DEADLINE_WINDOWS.find((value) => String(value) === event.target.value);
            set({ deadline: days });
          }}
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
        >
          <option value="">Any time</option>
          {DEADLINE_WINDOWS.map((days) => (
            <option key={days} value={String(days)}>
              {days} days
            </option>
          ))}
        </select>
        <Chip
          pressed={search.closed}
          onClick={() => {
            set({ closed: !search.closed });
          }}
        >
          Show closed
        </Chip>
        {hasCompetitionFilters(search) && (
          <button
            type="button"
            onClick={() => {
              onChange({ ...DEFAULT_COMPETITIONS_SEARCH, view: search.view });
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-surface-hover"
          >
            <X aria-hidden="true" className="size-3.5" />
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

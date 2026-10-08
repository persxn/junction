import {
  DEADLINE_WINDOWS,
  ENGAGEMENT_STATUSES,
  EVENT_TYPES,
  type CompetitionQueryInput,
  type EngagementStatus,
  type EventType,
} from '@compintel/contracts';

/**
 * The Competitions screen's router state (WP-19 step 6): board or list, and
 * the list's filters. Parsing is forgiving — a value an older build wrote falls
 * back to the default rather than breaking navigation — and `toQuery` is the
 * one place the filters become a `CompetitionQuery`.
 */

export type CompetitionsView = 'board' | 'list';
export type DeadlineWindow = (typeof DEADLINE_WINDOWS)[number];

export interface CompetitionsSearch {
  readonly view: CompetitionsView;
  readonly status: readonly EngagementStatus[];
  readonly teamId: string | undefined;
  readonly mine: boolean;
  readonly eventTypes: readonly EventType[];
  readonly deadline: DeadlineWindow | undefined;
  readonly closed: boolean;
}

export const DEFAULT_COMPETITIONS_SEARCH: CompetitionsSearch = {
  view: 'board',
  status: [],
  teamId: undefined,
  mine: false,
  eventTypes: [],
  deadline: undefined,
  closed: false,
};

const listOf = <T extends string>(raw: unknown, allowed: readonly T[]): T[] =>
  (Array.isArray(raw) ? raw : []).filter((value): value is T =>
    (allowed as readonly unknown[]).includes(value),
  );

export function parseCompetitionsSearch(raw: Record<string, unknown>): CompetitionsSearch {
  const deadline = DEADLINE_WINDOWS.find((days) => days === Number(raw.deadline));
  return {
    view: raw.view === 'list' ? 'list' : 'board',
    status: listOf(raw.status, ENGAGEMENT_STATUSES),
    teamId: typeof raw.teamId === 'string' && raw.teamId !== '' ? raw.teamId : undefined,
    mine: raw.mine === true,
    eventTypes: listOf(raw.eventTypes, EVENT_TYPES),
    deadline,
    closed: raw.closed === true,
  };
}

export function hasCompetitionFilters(search: CompetitionsSearch): boolean {
  return (
    search.status.length > 0 ||
    search.teamId !== undefined ||
    search.mine ||
    search.eventTypes.length > 0 ||
    search.deadline !== undefined ||
    search.closed
  );
}

/** The server query. The board always shows every open column, so it ignores `status`. */
export function toQuery(search: CompetitionsSearch): CompetitionQueryInput {
  const statuses = search.view === 'list' ? search.status : [];
  return {
    ...(statuses.length === 0 ? {} : { status: [...statuses] }),
    ...(search.teamId === undefined ? {} : { teamId: search.teamId }),
    ...(search.mine ? { mentorId: 'me' as const } : {}),
    ...(search.eventTypes.length === 0 ? {} : { eventTypes: [...search.eventTypes] }),
    ...(search.deadline === undefined ? {} : { deadlineWithinDays: search.deadline }),
    ...(search.closed ? { includeClosed: true } : {}),
  };
}

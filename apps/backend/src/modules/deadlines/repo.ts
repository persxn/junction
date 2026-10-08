import type { DeadlineGroup, DeadlineScope, DueItemKind } from '@compintel/contracts';

import type { DeadlineRow } from '../../domain/deadlines/buckets.js';
import type { DatabaseHandle } from '../../platform/db.js';

/**
 * SQL over `v_deadlines` (WP-22, R106, D-03) — and only here. One `whereFor`
 * decides who sees which rows, for the list, the counts and the KPI alike:
 *   mine — events I saved, and the events and work of competitions I actively
 *          mentor (primary or co-mentor);
 *   team — that team's active competitions, their events and work;
 *   all  — every active competition's events and work, plus events I saved
 *          (saving is personal).
 * An event I hid leaves my event deadlines; our work on it stays.
 */

export interface DeadlineFilter {
  readonly scope: DeadlineScope;
  readonly teamId?: string | undefined;
  readonly group?: DeadlineGroup | undefined;
  readonly itemKind?: DueItemKind | undefined;
}

const ACTIVE = `('ASSIGNED', 'APPLIED', 'PARTICIPATING')`;

const COLUMNS = `v.id, v.item_kind AS itemKind, v.deadline_kind AS deadlineKind, v.label,
  v.due_at AS dueAt, v.precision, v.event_id AS eventId, v.event_title AS eventTitle,
  v.event_timezone AS eventTimezone, v.engagement_id AS engagementId,
  v.competition_name AS competitionName, v.team_id AS teamId, v.team_name AS teamName,
  v.stage_id AS stageId, v.task_id AS taskId, v.origin, v.source_name AS sourceName`;

export function whereFor(
  filter: DeadlineFilter,
  userId: string,
): { readonly sql: string; readonly params: Record<string, string> } {
  const params: Record<string, string> = { user: userId };
  const savedByMe = `EXISTS (SELECT 1 FROM watchlist_items w WHERE w.event_id = v.event_id AND w.user_id = @user)`;
  const isEvent = `v.item_kind = 'EVENT_DEADLINE'`;
  const mentorOf = (engagement: string): string =>
    `EXISTS (SELECT 1 FROM engagement_mentors m WHERE m.engagement_id = ${engagement}
       AND m.user_id = @user AND m.to_at IS NULL)`;
  const activeOn = (extra: string): string =>
    `EXISTS (SELECT 1 FROM engagements g WHERE g.event_id = v.event_id AND g.status IN ${ACTIVE} ${extra})`;
  let scope: string;
  switch (filter.scope) {
    case 'MINE':
      scope = `((${isEvent} AND (${savedByMe} OR ${activeOn(`AND ${mentorOf('g.id')}`)}))
        OR (v.engagement_id IS NOT NULL AND ${mentorOf('v.engagement_id')}))`;
      break;
    case 'TEAM':
      params.team = filter.teamId ?? '';
      scope = `((${isEvent} AND ${activeOn('AND g.team_id = @team')}) OR v.team_id = @team)`;
      break;
    case 'ALL':
      scope = `((${isEvent} AND (${savedByMe} OR ${activeOn('')})) OR v.engagement_id IS NOT NULL)`;
      break;
  }
  const clauses = [
    scope,
    `NOT (${isEvent} AND EXISTS (SELECT 1 FROM event_user_state u WHERE u.event_id = v.event_id
       AND u.user_id = @user AND u.is_hidden = 1))`,
  ];
  if (filter.group === 'EVENTS') clauses.push(isEvent);
  if (filter.group === 'WORK') clauses.push(`v.item_kind IN ('STAGE', 'TASK')`);
  if (filter.itemKind !== undefined) {
    params.kind = filter.itemKind;
    clauses.push('v.item_kind = @kind');
  }
  return { sql: clauses.join(' AND '), params };
}

export class DeadlinesRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  /** The rows one person may see under a filter; buckets are the domain's. */
  rows(filter: DeadlineFilter, userId: string): DeadlineRow[] {
    const where = whereFor(filter, userId);
    return this.#db.raw
      .prepare(`SELECT ${COLUMNS} FROM v_deadlines v WHERE ${where.sql} ORDER BY v.due_at, v.id`)
      .all(where.params) as DeadlineRow[];
  }

  /** Every row, for the evaluator: it serves all scopes at once (R106 has no user column). */
  allRows(): DeadlineRow[] {
    return this.#db.raw
      .prepare(`SELECT ${COLUMNS} FROM v_deadlines v ORDER BY v.due_at, v.id`)
      .all() as DeadlineRow[];
  }
}

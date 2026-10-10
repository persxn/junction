import {
  ACTIVE_COMPETITION_STATUSES,
  FUNNEL_STAGES,
  type DeadlineHit,
  type EngagementStatus,
  type Funnel,
  type Milestone,
  type MonthPoint,
  type Streaks,
} from '@compintel/contracts';

import { APP_TIMEZONE } from '../../platform/time.js';
import {
  monthOf,
  monthSpan,
  monthsBetween,
  weekOf,
  weekSpan,
  weeksBetween,
  type Span,
} from './calendar.js';

/**
 * The Insights aggregates that need more than a GROUP BY (WP-33, R69): they
 * walk each competition's status history. Pure — the rows are handed in — and
 * deterministic: the same rows and the same `now` give the same numbers.
 */

/** One row of `engagement_status_history`. */
export interface StatusChange {
  readonly engagementId: string;
  readonly toStatus: EngagementStatus;
  readonly changedAt: number;
}

/** A competition as the funnel sees it. */
export interface CompetitionFacts {
  readonly id: string;
  readonly status: EngagementStatus;
  readonly createdAt: number;
}

/** A workflow stage as the deadline-hit rate sees it. */
export interface StageFacts {
  readonly dueAt: number | null;
  readonly completedAt: number | null;
}

const ACTIVE = new Set<EngagementStatus>(ACTIVE_COMPETITION_STATUSES);

/**
 * `[start, end)` intervals during which each competition was active. The
 * current status is open-ended (`end` = Infinity); a status that was replaced
 * in the same instant it was entered leaves no interval.
 */
export function activeIntervals(history: readonly StatusChange[]): Span[] {
  const byEngagement = new Map<string, StatusChange[]>();
  for (const change of history) {
    const list = byEngagement.get(change.engagementId) ?? [];
    list.push(change);
    byEngagement.set(change.engagementId, list);
  }
  const out: Span[] = [];
  for (const changes of byEngagement.values()) {
    changes.sort((a, b) => a.changedAt - b.changedAt);
    changes.forEach((change, index) => {
      if (!ACTIVE.has(change.toStatus)) return;
      const end = changes[index + 1]?.changedAt ?? Infinity;
      if (end > change.changedAt) out.push({ start: change.changedAt, end });
    });
  }
  return out;
}

/** True when some interval overlaps `span`. */
function activeIn(intervals: readonly Span[], span: Span): boolean {
  return intervals.some((interval) => interval.start < span.end && interval.end > span.start);
}

/** Distinct competitions active at some instant of `span`. */
function countActive(history: readonly StatusChange[], span: Span): number {
  const ids = new Set<string>();
  const sorted = [...history].sort((a, b) => a.changedAt - b.changedAt);
  const next = new Map<string, number>();
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const change = sorted[i]!;
    const end = next.get(change.engagementId) ?? Infinity;
    next.set(change.engagementId, change.changedAt);
    const nonEmpty = end > change.changedAt;
    if (
      ACTIVE.has(change.toStatus) &&
      nonEmpty &&
      change.changedAt < span.end &&
      end > span.start
    ) {
      ids.add(change.engagementId);
    }
  }
  return ids.size;
}

/** The first time each competition entered `status`. */
function firstEntry(
  history: readonly StatusChange[],
  status: EngagementStatus,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const change of history) {
    if (change.toStatus !== status) continue;
    const seen = out.get(change.engagementId);
    if (seen === undefined || change.changedAt < seen)
      out.set(change.engagementId, change.changedAt);
  }
  return out;
}

/** Participation over time: one point per month of the range. */
export function participation(
  history: readonly StatusChange[],
  range: { from: string; to: string; span: Span },
  now: number,
  zone: string = APP_TIMEZONE,
): MonthPoint[] {
  const firstAssigned = firstEntry(history, 'ASSIGNED');
  return monthsBetween(range.from, range.to).map((month) => {
    const span = monthSpan(month, range.span, zone);
    let assigned = 0;
    for (const at of firstAssigned.values()) {
      if (at >= span.start && at < span.end && monthOf(at, zone) === month) assigned += 1;
    }
    // Up to and including `now`: a month that has not started yet has no activity.
    const clipped = { start: span.start, end: Math.min(span.end, now + 1) };
    const active = clipped.end > clipped.start ? countActive(history, clipped) : 0;
    return { month, assigned, active };
  });
}

/** The engagement funnel over the competitions created in the range. */
export function funnel(
  competitions: readonly CompetitionFacts[],
  history: readonly StatusChange[],
): Funnel {
  const furthest = new Map<string, number>();
  const stageIndex = (status: EngagementStatus): number =>
    (FUNNEL_STAGES as readonly EngagementStatus[]).indexOf(status);
  for (const competition of competitions)
    furthest.set(competition.id, stageIndex(competition.status));
  for (const change of history) {
    const current = furthest.get(change.engagementId);
    if (current === undefined) continue;
    furthest.set(change.engagementId, Math.max(current, stageIndex(change.toStatus)));
  }
  const steps = FUNNEL_STAGES.map((status, index) => ({
    status,
    reached: [...furthest.values()].filter((reached) => reached >= index).length,
  }));
  const withdrawn = competitions.filter((c) => c.status === 'WITHDRAWN').length;
  const notSelected = competitions.filter((c) => c.status === 'NOT_SELECTED').length;
  const completed = steps[steps.length - 1]!.reached;
  return {
    steps,
    total: competitions.length,
    withdrawn,
    notSelected,
    completion: { numerator: completed, denominator: competitions.length - withdrawn },
  };
}

/** Met vs missed for stages due in the range and already past due. */
export function deadlineHit(stages: readonly StageFacts[], span: Span, now: number): DeadlineHit {
  let met = 0;
  let missed = 0;
  let undated = 0;
  for (const stage of stages) {
    if (stage.dueAt === null) {
      undated += 1;
      continue;
    }
    if (stage.dueAt < span.start || stage.dueAt >= span.end || stage.dueAt > now) continue;
    if (stage.completedAt !== null && stage.completedAt <= stage.dueAt) met += 1;
    else missed += 1;
  }
  return { met, missed, undated };
}

/** Weeks with at least one active competition; weeks after `now` are not counted. */
export function streaks(
  history: readonly StatusChange[],
  range: { from: string; to: string; span: Span },
  now: number,
  zone: string = APP_TIMEZONE,
): Streaks {
  const intervals = activeIntervals(history);
  const lastWeek = weekOf(Math.min(range.span.end - 1, now), zone);
  const weeks = weeksBetween(range.from, range.to).filter((week) => week <= lastWeek);
  const flags = weeks.map((week) => {
    const span = weekSpan(week, range.span, zone);
    return activeIn(intervals, { start: span.start, end: Math.min(span.end, now + 1) });
  });
  let longest = 0;
  let run = 0;
  for (const flag of flags) {
    run = flag ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return {
    activeWeeks: flags.filter(Boolean).length,
    weeksInRange: weeks.length,
    longest,
    current: run,
  };
}

/** The recorded facts worth one acknowledgement each (R69). All time, not ranged. */
export function milestones(
  history: readonly StatusChange[],
  winnerAt: readonly number[],
  now: number,
  zone: string = APP_TIMEZONE,
): Milestone[] {
  const out: Milestone[] = [];
  const firstWin = winnerAt.length > 0 ? Math.min(...winnerAt) : undefined;
  if (firstWin !== undefined) {
    out.push({
      kind: 'FIRST_WINNER',
      id: 'FIRST_WINNER',
      at: new Date(firstWin).toISOString(),
      title: 'First win recorded',
    });
  }
  const completions = [...firstEntry(history, 'COMPLETED').values()].sort((a, b) => a - b);
  const tenth = completions[9];
  if (tenth !== undefined) {
    out.push({
      kind: 'TENTH_COMPLETED',
      id: 'TENTH_COMPLETED',
      at: new Date(tenth).toISOString(),
      title: '10 competitions completed',
    });
  }
  const intervals = activeIntervals(history);
  const starts = intervals.map((interval) => interval.start);
  if (starts.length > 0) {
    const first = weekOf(Math.min(...starts), zone);
    const last = weekOf(now, zone);
    let run = 0;
    for (let week = first; week <= last; week += 7) {
      const span = weekSpan(week, { start: -Infinity, end: now + 1 }, zone);
      run = activeIn(intervals, span) ? run + 1 : 0;
      if (run === 4) {
        out.push({
          kind: 'FOUR_WEEK_STREAK',
          id: 'FOUR_WEEK_STREAK',
          at: new Date(span.start).toISOString(),
          title: 'Four weeks in a row with an active competition',
        });
        break;
      }
    }
  }
  return out;
}

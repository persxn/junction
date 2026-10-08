import { OPEN_STAGE_STATUSES, type ScheduleHealth, type StageStatus } from '@compintel/contracts';

import { formatDay } from '../../platform/time.js';
import { addDays } from './due.js';

/**
 * R99's schedule health, pure: the first state that matches, with a one-line
 * reason a professor can act on.
 *
 *   BLOCKED   any BLOCKED stage
 *   OVERDUE   an open stage past its date
 *   AT_RISK   an open stage due within 48 h and under 50 % done
 *   ON_TRACK  an open stage with a date, or every stage COMPLETED/SKIPPED
 *   NO_DATES  otherwise
 */

export const AT_RISK_WINDOW_MS = 48 * 3_600_000;

export interface HealthStage {
  readonly name: string;
  readonly status: StageStatus;
  readonly dueAt: number | null;
  /** `stageProgress().value`; null for SKIPPED. */
  readonly progress: number | null;
  readonly tasksDone: number;
  readonly tasksTotal: number;
  readonly blockedReason: string | null;
}

export interface Health {
  readonly health: ScheduleHealth;
  readonly reason: string;
}

const isOpen = (stage: HealthStage): boolean =>
  (OPEN_STAGE_STATUSES as readonly StageStatus[]).includes(stage.status);

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/** Whole calendar days from `now`'s local day to `at`'s, in `zone`. */
export function calendarDays(now: number, at: number, zone: string): number {
  const from = formatDay(zone, new Date(now));
  const to = formatDay(zone, new Date(at));
  let days = 0;
  if (to >= from) {
    for (let day = from; day < to && days < 3660; day = addDays(day, 1)) days += 1;
    return days;
  }
  for (let day = to; day < from && days < 3660; day = addDays(day, 1)) days += 1;
  return -days;
}

/** "7 Oct" in the display zone. */
export function shortDate(at: number, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short' })
    .format(new Date(at))
    .replace('Sept', 'Sep');
}

function dueWords(now: number, at: number, zone: string): string {
  const days = calendarDays(now, at, zone);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${String(days)} days`;
}

function doneText(stage: HealthStage): string {
  if (stage.tasksTotal > 0) {
    return `${String(stage.tasksDone)} of ${String(stage.tasksTotal)} tasks done`;
  }
  return `${String(Math.round(stage.progress ?? 0))}% done`;
}

export function scheduleHealth(input: {
  readonly stages: readonly HealthStage[];
  readonly now: number;
  readonly zone: string;
}): Health {
  const { stages, now, zone } = input;
  const open = stages.filter(isOpen);
  const undated = open.filter((stage) => stage.dueAt === null).length;
  const suffix = undated === 0 ? '' : ` · ${plural(undated, 'stage has', 'stages have')} no date`;

  const blocked = stages.filter((stage) => stage.status === 'BLOCKED');
  const firstBlocked = blocked[0];
  if (firstBlocked !== undefined) {
    const more = blocked.length > 1 ? ` and ${String(blocked.length - 1)} more` : '';
    return {
      health: 'BLOCKED',
      reason: `Blocked: ${firstBlocked.name} — ${firstBlocked.blockedReason ?? 'no reason given'}${more}`,
    };
  }

  const dated = open
    .filter((stage): stage is HealthStage & { dueAt: number } => stage.dueAt !== null)
    .sort((a, b) => a.dueAt - b.dueAt);

  const overdue = dated.filter((stage) => stage.dueAt < now);
  const oldest = overdue[0];
  if (oldest !== undefined) {
    if (overdue.length > 1) {
      return {
        health: 'OVERDUE',
        reason: `${String(overdue.length)} stages overdue — oldest ${oldest.name}${suffix}`,
      };
    }
    const ago = -calendarDays(now, oldest.dueAt, zone);
    const when = ago <= 0 ? 'earlier today' : ago === 1 ? '1 day ago' : `${String(ago)} days ago`;
    return {
      health: 'OVERDUE',
      reason: `${oldest.name} was due ${when}, ${String(Math.round(oldest.progress ?? 0))}% done${suffix}`,
    };
  }

  const atRisk = dated.find(
    (stage) => stage.dueAt - now <= AT_RISK_WINDOW_MS && (stage.progress ?? 0) < 50,
  );
  if (atRisk !== undefined) {
    return {
      health: 'AT_RISK',
      reason: `${atRisk.name} due ${dueWords(now, atRisk.dueAt, zone)}, ${doneText(atRisk)}${suffix}`,
    };
  }

  const next = dated[0];
  if (next !== undefined) {
    return {
      health: 'ON_TRACK',
      reason: `Next: ${next.name} due ${shortDate(next.dueAt, zone)}${suffix}`,
    };
  }
  if (stages.length > 0 && open.length === 0) {
    return { health: 'ON_TRACK', reason: 'All stages done' };
  }
  return {
    health: 'NO_DATES',
    reason: stages.length === 0 ? 'No stages yet' : 'No stage has a date yet',
  };
}

import type { DatePrecision, DeadlineKind, DueRule } from '@compintel/contracts';

import {
  endOfDayIn,
  formatDay,
  parseDay,
  toUtcInstant,
  zonedDayBounds,
} from '../../platform/time.js';

/**
 * R100's due rules, pure: a stage's date from an event date plus a number of
 * calendar days in the display zone, keeping the time of day. A date-only
 * anchor resolves to the end of that local day; a MONTH or UNKNOWN date, or a
 * missing one, gives no date at all — never a guess.
 */

export interface DatedValue {
  readonly at: number;
  readonly precision: DatePrecision;
}

export interface EventDates {
  readonly registrationDeadline: DatedValue | null;
  readonly submissionDeadline: DatedValue | null;
  readonly start: DatedValue | null;
  readonly end: DatedValue | null;
  readonly deadlines: readonly {
    readonly kind: DeadlineKind;
    readonly at: number;
    readonly precision: DatePrecision;
  }[];
}

function anchorOf(rule: DueRule, dates: EventDates): DatedValue | null {
  switch (rule.anchor) {
    case 'REGISTRATION_DEADLINE':
      return dates.registrationDeadline;
    case 'SUBMISSION_DEADLINE':
      return dates.submissionDeadline;
    case 'EVENT_START':
      return dates.start;
    case 'EVENT_END':
      return dates.end;
    case 'DEADLINE': {
      // The earliest row of that kind.
      const rows = dates.deadlines
        .filter((row) => row.kind === rule.kind)
        .sort((a, b) => a.at - b.at);
      const first = rows[0];
      return first === undefined ? null : { at: first.at, precision: first.precision };
    }
  }
}

/** `YYYY-MM-DD` plus `days` calendar days. */
export function addDays(day: string, days: number): string {
  const { year, month, day: dayOfMonth } = parseDay(day);
  const shifted = new Date(Date.UTC(year, month - 1, dayOfMonth + days));
  return shifted.toISOString().slice(0, 10);
}

/** The instant `rule` gives for this event, or null when it cannot be known. */
export function resolveDueAt(rule: DueRule, dates: EventDates, zone: string): number | null {
  const anchor = anchorOf(rule, dates);
  if (anchor === null) return null;
  if (anchor.precision === 'MONTH' || anchor.precision === 'UNKNOWN') return null;
  const day = formatDay(zone, new Date(anchor.at));
  const target = addDays(day, rule.offsetDays);
  if (anchor.precision === 'DATE') return endOfDayIn(zone, target).getTime();
  // DATETIME: the same wall-clock time on the shifted day.
  const timeOfDay = anchor.at - zonedDayBounds(zone, day).startUtc.getTime();
  const hour = Math.floor(timeOfDay / 3_600_000);
  const minute = Math.floor((timeOfDay % 3_600_000) / 60_000);
  const second = Math.floor((timeOfDay % 60_000) / 1000);
  const { year, month, day: dayOfMonth } = parseDay(target);
  return toUtcInstant(
    { year, month, day: dayOfMonth, hour, minute, second, millisecond: timeOfDay % 1000 },
    zone,
  ).getTime();
}

/** How a rule reads in a template editor: "Registration deadline − 2 days". */
export function ruleText(rule: DueRule, anchorLabel: string): string {
  if (rule.offsetDays === 0) return anchorLabel;
  const days = Math.abs(rule.offsetDays);
  return `${anchorLabel} ${rule.offsetDays < 0 ? '−' : '+'} ${String(days)} ${days === 1 ? 'day' : 'days'}`;
}

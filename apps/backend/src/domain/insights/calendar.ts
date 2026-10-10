import { APP_TIMEZONE, formatDay, parseDay, zonedDayBounds } from '../../platform/time.js';

/**
 * The calendar the Insights surface counts in (WP-33, A7): Asia/Kolkata days,
 * calendar months and Monday-start weeks. Pure; the zone is a parameter so a
 * test can name it, and every bucket is derived from the local day an instant
 * falls on — never from UTC arithmetic.
 */

const DAY_MS = 86_400_000;

/** `[start, end)` in UTC milliseconds. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** The inclusive A7 range `from..to` as a half-open span. */
export function rangeSpan(from: string, to: string, zone: string = APP_TIMEZONE): Span {
  return {
    start: zonedDayBounds(zone, from).startUtc.getTime(),
    end: zonedDayBounds(zone, to).endUtcExclusive.getTime(),
  };
}

/** Days since 1970-01-01 of a `YYYY-MM-DD` day (a plain calendar count). */
function dayNumber(day: string): number {
  const { year, month, day: dayOfMonth } = parseDay(day);
  return Date.UTC(year, month - 1, dayOfMonth) / DAY_MS;
}

function dayFromNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM` of the local day `ms` falls on. */
export function monthOf(ms: number, zone: string = APP_TIMEZONE): string {
  return formatDay(zone, new Date(ms)).slice(0, 7);
}

/** Every `YYYY-MM` from the month of `from` to the month of `to`, in order. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    out.push(key);
    if (key >= last) return out;
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
}

/** The span of one local month, clipped to `clip` (the requested range). */
export function monthSpan(month: string, clip: Span, zone: string = APP_TIMEZONE): Span {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const next =
    index === 12
      ? `${String(year + 1)}-01-01`
      : `${month.slice(0, 5)}${String(index + 1).padStart(2, '0')}-01`;
  return {
    start: Math.max(clip.start, zonedDayBounds(zone, `${month}-01`).startUtc.getTime()),
    end: Math.min(clip.end, zonedDayBounds(zone, next).startUtc.getTime()),
  };
}

/** The Monday that starts the week of a local day, as a day number. */
export function weekOfDay(day: string): number {
  const n = dayNumber(day);
  // 1970-01-01 was a Thursday; +3 makes Monday 0.
  return n - ((n + 3) % 7);
}

/** The week (its Monday's day number) the local day of `ms` belongs to. */
export function weekOf(ms: number, zone: string = APP_TIMEZONE): number {
  return weekOfDay(formatDay(zone, new Date(ms)));
}

/** Every week touching `from..to`, as Monday day numbers, in order. */
export function weeksBetween(from: string, to: string): number[] {
  const out: number[] = [];
  for (let week = weekOfDay(from); week <= weekOfDay(to); week += 7) out.push(week);
  return out;
}

/** The span of the week starting on Monday `week`, clipped to `clip`. */
export function weekSpan(week: number, clip: Span, zone: string = APP_TIMEZONE): Span {
  return {
    start: Math.max(clip.start, zonedDayBounds(zone, dayFromNumber(week)).startUtc.getTime()),
    end: Math.min(clip.end, zonedDayBounds(zone, dayFromNumber(week + 7)).startUtc.getTime()),
  };
}

/** The default range: the twelve months up to and including `today`. */
export function defaultRange(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const startMonth = month === 12 ? 1 : month + 1;
  const startYear = month === 12 ? year : year - 1;
  return {
    from: `${String(startYear).padStart(4, '0')}-${String(startMonth).padStart(2, '0')}-01`,
    to: today,
  };
}

/** Whole days in `from..to`, inclusive. */
export function daysInRange(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

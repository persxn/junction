import type { CandidateDate, DatePrecision } from '@compintel/contracts';
import * as chrono from 'chrono-node';

import {
  endOfDayIn,
  formatDay,
  isValidTimeZone,
  nowMs,
  offsetMinutesAt,
  toUtcInstant,
  type Clock,
} from '../../platform/time.js';
import type { WarningCollector } from './warnings.js';

/**
 * Dates — half of what this product is (§7.3, ADR-0015).
 *
 * The rule that governs everything here: **a wrong deadline is worse than an
 * unknown one.** Nothing is guessed. A field that cannot be resolved with
 * confidence is absent and a warning says why, because a professor who sees
 * "time not stated" checks the source page, and a professor who sees a
 * plausible wrong time does not.
 *
 * Resolution order is fixed by R52 and never reordered: a structured value the
 * source gave us, then a source-specific pattern, then chrono-node on prose.
 * chrono is last because it is the only one that can be confidently wrong.
 *
 * All the zone arithmetic goes through `platform/time.ts`, which is also where
 * the "date-only means the end of that local day" rule lives. This file decides
 * *which* zone applies; it does no arithmetic of its own.
 */

/** How far out a date may be before it is certainly a parse error (§7.3). */
export const MIN_YEARS_BEHIND = 1;
export const MAX_YEARS_AHEAD = 5;

/** §7.3: an Indian venue with no stated zone means IST. */
export const INDIA_TIMEZONE = 'Asia/Kolkata';

/** What the timezone precedence had to fall back on, for the warning. */
export type TimezoneSource = 'EXPLICIT' | 'VENUE' | 'SOURCE_DEFAULT' | 'ASSUMED_UTC';

export interface TimezoneResolution {
  readonly timezone: string;
  readonly from: TimezoneSource;
  /** True when UTC was assumed: a date read through that zone drops a step (§7.3, R85). */
  readonly lowerPrecision: boolean;
}

export interface TimezoneInputs {
  /** What the source said, if anything. May be nonsense. */
  readonly stated?: string | undefined;
  /** ISO 3166-1 alpha-2 of the venue, if the source gave a place. */
  readonly countryCode?: string | undefined;
  /** The adapter's configured default for this source. */
  readonly sourceDefault?: string | undefined;
}

/**
 * §7.3's precedence, in order: explicit in the source > venue location (India →
 * Asia/Kolkata) > source default > UTC, lowering what was read through it (R85).
 *
 * An unusable IANA name is **rejected and falls through**, never silently
 * treated as UTC: the time layer refuses bare abbreviations because ICU resolves
 * `EST` to a fixed −05:00 zone that never observes DST, and a source saying
 * "IST+5.30" is a normalization problem rather than a zone.
 */
export function resolveTimezone(
  inputs: TimezoneInputs,
  warnings?: WarningCollector,
): TimezoneResolution {
  if (inputs.stated !== undefined && inputs.stated.trim().length > 0) {
    const stated = inputs.stated.trim();
    if (isValidTimeZone(stated)) {
      return { timezone: stated, from: 'EXPLICIT', lowerPrecision: false };
    }
    warnings?.add(
      'TIMEZONE_INVALID',
      `"${stated}" is not a usable IANA time zone; falling back to the venue.`,
      'timezone',
    );
  }
  if (inputs.countryCode?.toUpperCase() === 'IN') {
    return { timezone: INDIA_TIMEZONE, from: 'VENUE', lowerPrecision: false };
  }
  if (inputs.sourceDefault !== undefined && isValidTimeZone(inputs.sourceDefault)) {
    return { timezone: inputs.sourceDefault, from: 'SOURCE_DEFAULT', lowerPrecision: false };
  }
  warnings?.add(
    'TIMEZONE_ASSUMED',
    'No usable time zone was found; UTC was assumed and dates without their own offset lowered in precision.',
    'timezone',
  );
  return { timezone: 'UTC', from: 'ASSUMED_UTC', lowerPrecision: true };
}

/** One step down the precision ladder; `UNKNOWN` is the floor. */
export function lowerPrecision(precision: DatePrecision): DatePrecision {
  switch (precision) {
    case 'DATETIME':
      return 'DATE';
    case 'DATE':
      return 'MONTH';
    default:
      return 'UNKNOWN';
  }
}

/** True when `at` falls inside §7.3's plausible window around the clock's now. */
export function isPlausibleInstant(at: number, clock: Clock): boolean {
  const now = new Date(nowMs(clock));
  const earliest = Date.UTC(now.getUTCFullYear() - MIN_YEARS_BEHIND, 0, 1);
  const latest = Date.UTC(now.getUTCFullYear() + MAX_YEARS_AHEAD, 11, 31, 23, 59, 59, 999);
  return at >= earliest && at <= latest;
}

export interface ParseDateOptions {
  readonly timezone: string;
  readonly clock: Clock;
  /** Which candidate field this is, for the warning. */
  readonly field: string;
  /**
   * A date-only value means the **end** of that local day for a deadline
   * (§7.3), and the start of it for anything else.
   */
  readonly dateOnlyMeans: 'END_OF_DAY' | 'START_OF_DAY';
  readonly warnings?: WarningCollector | undefined;
  /** Set when the timezone was assumed; every precision drops a step. */
  readonly lowerPrecision?: boolean | undefined;
}

/** A structured value a source handed over: an epoch or an ISO 8601 string. */
export type StructuredDate = number | string;

/**
 * Step 1 of the order: a value the source stated structurally.
 *
 * A number is Unix seconds or milliseconds — told apart by magnitude, since a
 * seconds value for any date this product cares about is ten digits and a
 * milliseconds one is thirteen. An ISO string with an offset or a `Z` is an
 * instant and is used as-is; one without is a *local* reading and is resolved
 * through the event's timezone, which is the case that would otherwise silently
 * shift a deadline by five and a half hours.
 */
export function fromStructured(
  value: StructuredDate,
  options: ParseDateOptions,
): CandidateDate | undefined {
  const { warnings, field } = options;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    const at = Math.abs(value) < 1e11 ? Math.round(value * 1000) : Math.round(value);
    return finish(at, 'DATETIME', String(value), 1, options, true);
  }

  const text = value.trim();
  if (text.length === 0) {
    return undefined;
  }

  // Date-only: no time was stated, so the local day is what was meant.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly !== null) {
    const day = text;
    const at =
      options.dateOnlyMeans === 'END_OF_DAY'
        ? endOfDayIn(options.timezone, day).getTime()
        : toUtcInstant(
            {
              year: Number(dateOnly[1]),
              month: Number(dateOnly[2]),
              day: Number(dateOnly[3]),
            },
            options.timezone,
          ).getTime();
    return finish(at, 'DATE', text, 1, options);
  }

  // Month only: "2026-09". The first instant of the month, precision MONTH.
  const monthOnly = /^(\d{4})-(\d{2})$/.exec(text);
  if (monthOnly !== null) {
    const at = toUtcInstant(
      { year: Number(monthOnly[1]), month: Number(monthOnly[2]), day: 1 },
      options.timezone,
    ).getTime();
    return finish(at, 'MONTH', text, 1, options);
  }

  // An offset-free date-time is a *local* reading, and it is read here rather
  // than by `Date.parse`. `Date.parse('2026-10-01T10:00:00')` resolves it in the
  // *host machine's* zone, which is neither the event's zone nor a constant: the
  // same fixture would parse differently on a developer's laptop in IST and on a
  // build machine in UTC.
  const naive = NAIVE_DATETIME.exec(text);
  if (naive !== null) {
    const at = toUtcInstant(
      {
        year: Number(naive[1]),
        month: Number(naive[2]),
        day: Number(naive[3]),
        hour: Number(naive[4]),
        minute: Number(naive[5]),
        second: Number(naive[6] ?? '0'),
        millisecond: Number((naive[7] ?? '0').padEnd(3, '0').slice(0, 3)),
      },
      options.timezone,
    ).getTime();
    return finish(at, 'DATETIME', text, 1, options);
  }

  // Anything left has an offset, or a shape only `Date.parse` knows.
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    warnings?.add('DATE_UNPARSEABLE', `Could not read "${text.slice(0, 60)}" as a date.`, field);
    return undefined;
  }
  // R85: an explicit offset or `Z` is exact whatever zone was assumed.
  return finish(parsed, 'DATETIME', text, 1, options, EXPLICIT_OFFSET.test(text));
}

const EXPLICIT_OFFSET = /(?:z|[+-]\d{2}(?::?\d{2})?)$/i; // R85: Z or ±HH[:MM] at the end

/** `YYYY-MM-DDTHH:MM[:SS[.sss]]` with no zone or offset. */
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;

/**
 * Step 3 of the order: chrono-node on prose ("registration closes on 27th
 * September", "Oct 3–5").
 *
 * Last, and with a lowered confidence, because chrono is the only step that can
 * be confidently wrong — it will happily read a version number as a date. Its
 * reference instant is the injected clock, never `new Date()` (R52), so "next
 * Friday" in a fixture means the same thing on every run forever.
 */
export function fromProse(text: string, options: ParseDateOptions): CandidateDate | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const reference = referenceFor(options);
  const results = chrono.parse(trimmed, reference, { forwardDate: true });
  const result = results[0];
  if (result === undefined) {
    options.warnings?.add(
      'DATE_UNPARSEABLE',
      `Could not read a date from "${trimmed.slice(0, 60)}".`,
      options.field,
    );
    return undefined;
  }

  const start = result.start;
  const knowsTime = start.isCertain('hour');
  const knowsDay = start.isCertain('day');

  if (!knowsDay) {
    // A month with no day: the first of that month, precision MONTH.
    const at = toUtcInstant(
      {
        year: start.get('year') ?? new Date(reference).getUTCFullYear(),
        month: start.get('month') ?? 1,
        day: 1,
      },
      options.timezone,
    ).getTime();
    return finish(at, 'MONTH', result.text, 0.6, options);
  }

  const parts = {
    year: start.get('year') ?? new Date(reference).getUTCFullYear(),
    month: start.get('month') ?? 1,
    day: start.get('day') ?? 1,
  };

  if (!knowsTime) {
    const day = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    const at =
      options.dateOnlyMeans === 'END_OF_DAY'
        ? endOfDayIn(options.timezone, day).getTime()
        : toUtcInstant(parts, options.timezone).getTime();
    return finish(at, 'DATE', result.text, 0.7, options);
  }

  const at = toUtcInstant(
    {
      ...parts,
      hour: start.get('hour') ?? 0,
      minute: start.get('minute') ?? 0,
      second: start.get('second') ?? 0,
    },
    options.timezone,
  ).getTime();
  return finish(at, 'DATETIME', result.text, 0.75, options);
}

/**
 * chrono's reference instant, expressed in the event's zone.
 *
 * chrono reads "27 September" relative to a reference and produces a *local*
 * wall-clock reading, which this file then re-anchors with `toUtcInstant`.
 * Handing it the raw UTC instant would make "today" mean the wrong day for an
 * IST event between 18:30 and midnight UTC.
 */
function referenceFor(options: ParseDateOptions): Date {
  const now = new Date(nowMs(options.clock));
  return new Date(now.getTime() + offsetMinutesAt(options.timezone, now) * 60_000);
}

/**
 * Applies the plausibility window and the assumed-UTC precision drop — which
 * R85 confines to readings that needed the zone: an `exact` instant keeps it.
 */
function finish(
  at: number,
  precision: DatePrecision,
  raw: string,
  confidence: number,
  options: ParseDateOptions,
  exact = false,
): CandidateDate | undefined {
  if (!Number.isFinite(at)) {
    return undefined;
  }
  if (!isPlausibleInstant(at, options.clock)) {
    options.warnings?.add(
      'DATE_OUT_OF_RANGE',
      `${formatDay('UTC', new Date(at))} is outside the plausible window ` +
        `(this year − ${String(MIN_YEARS_BEHIND)} to + ${String(MAX_YEARS_AHEAD)}); the field was dropped.`,
      options.field,
    );
    return undefined;
  }
  const finalPrecision =
    options.lowerPrecision === true && !exact ? lowerPrecision(precision) : precision;
  return { at, precision: finalPrecision, raw, confidence };
}

/**
 * Steps 1 → 3 in order (R52): a structured value if the source gave one,
 * otherwise prose. A source-specific pattern is step 2 and belongs to the
 * adapter, which passes its result in as `structured`.
 */
export function parseDate(
  input: { structured?: StructuredDate | undefined; text?: string | undefined },
  options: ParseDateOptions,
): CandidateDate | undefined {
  if (input.structured !== undefined) {
    const parsed = fromStructured(input.structured, options);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  if (input.text !== undefined) {
    return fromProse(input.text, options);
  }
  return undefined;
}

export interface DateRange {
  readonly startsAt?: CandidateDate | undefined;
  readonly endsAt?: CandidateDate | undefined;
}

/**
 * §7.3: "impossible dates (end before start, year far off) → field dropped +
 * warning; never guessed."
 *
 * Both ends are dropped, not just the end. If the two disagree, we do not know
 * which one is wrong, and keeping the start would present a guess as a fact.
 */
export function validateRange(range: DateRange, warnings?: WarningCollector): DateRange {
  const { startsAt, endsAt } = range;
  if (startsAt !== undefined && endsAt !== undefined && endsAt.at < startsAt.at) {
    warnings?.add(
      'DATE_RANGE_INVALID',
      'The end date is before the start date; both were dropped rather than reordered.',
      'startsAt',
    );
    return {};
  }
  return range;
}

/**
 * The precision to store for the start/end pair (§6.2 `date_precision`): the
 * coarser of the two, since the pair is only as precise as its vaguer half.
 */
export function combinedPrecision(range: DateRange): DatePrecision {
  const order: DatePrecision[] = ['DATETIME', 'DATE', 'MONTH', 'UNKNOWN'];
  const rank = (date?: CandidateDate): number =>
    date === undefined ? order.length - 1 : order.indexOf(date.precision);
  const coarser = Math.max(rank(range.startsAt), rank(range.endsAt));
  if (range.startsAt === undefined && range.endsAt === undefined) {
    return 'UNKNOWN';
  }
  return order[coarser] ?? 'UNKNOWN';
}

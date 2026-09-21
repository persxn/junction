import type { DatePrecision, OverrideField } from '@compintel/contracts';

import { DISPLAY_ZONE, formatDate } from '../format.js';

/**
 * How one claimed value is written on the screen (§16.2).
 *
 * The rule everything here follows is §7.5's: **show what the source said**. A
 * number is shown as the number it is, a string as the string it is, and a
 * value nobody stated says so in words rather than leaving a gap that could be
 * read as agreement. Nothing is converted — a fee in minor units is not turned
 * into a currency it has no currency for — because the panel this feeds exists
 * precisely to prove that no conversion happened.
 */

const DATE_FIELDS: ReadonlySet<OverrideField> = new Set([
  'registrationOpensAt',
  'registrationDeadlineAt',
  'startsAt',
  'endsAt',
  'submissionDeadlineAt',
]);

const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** What a `DATE`-precision value is allowed to say: the day, and no invented time. */
export function formatDeadline(at: number, precision: DatePrecision, now: number): string {
  const day = formatDate(at, precision, now);
  if (precision === 'DATETIME') {
    return `${day}, ${TIME.format(new Date(at))}`;
  }
  if (precision === 'MONTH') {
    return day;
  }
  // ADR-0015: a day-only date is "by 27 Sep", never "27 Sep, 00:00".
  return `by ${day}`;
}

/** One claim's value, for the provenance tooltip and the "Sources disagree" panel. */
export function formatClaimValue(field: OverrideField, value: unknown, now: number): string {
  if (value === null || value === undefined || value === '') {
    return 'Not stated';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number' && DATE_FIELDS.has(field)) {
    return formatDeadline(value, 'DATETIME', now);
  }
  if (typeof value === 'number') {
    return new Intl.NumberFormat('en-IN').format(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

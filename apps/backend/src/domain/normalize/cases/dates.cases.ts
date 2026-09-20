import type { NormalizeCase } from './case.js';

/**
 * Dates — the family that decides whether this product is trustworthy (§7.3,
 * ADR-0015). Every case runs at the fixed clock, 2026-09-20T09:00Z.
 *
 * Read the `at` values as instants: `2026-09-27T18:29:59.999Z` is the last
 * millisecond of 27 September in Asia/Kolkata, which is exactly what a date-only
 * registration deadline means.
 */

const IST_PLACE = { countryCode: 'IN', city: 'Mumbai' } as const;

/** Keeps the tables readable; an instant is written as the ISO string it is. */
const at = (iso: string): number => Date.parse(iso);

export const DATE_CASES: readonly NormalizeCase[] = [
  {
    name: 'takes an explicit IANA zone over everything else',
    input: {
      timezone: 'Asia/Kolkata',
      place: { countryCode: 'US' },
      startsAt: { structured: '2026-10-01T10:00:00' },
    },
    // 10:00 IST, not 10:00 anywhere else.
    expect: { fields: { timezone: 'Asia/Kolkata', 'startsAt.at': at('2026-10-01T04:30:00.000Z') } },
  },
  {
    name: 'falls back to IST for an Indian venue with no stated zone',
    input: { place: IST_PLACE, startsAt: { structured: '2026-10-01T10:00:00' } },
    expect: { fields: { timezone: 'Asia/Kolkata', 'startsAt.at': at('2026-10-01T04:30:00.000Z') } },
  },
  {
    name: 'uses the adapter default when the venue says nothing',
    input: { startsAt: { structured: '2026-10-01T10:00:00' } },
    expect: { fields: { timezone: 'Asia/Kolkata' }, noWarnings: ['TIMEZONE_ASSUMED'] },
  },
  {
    name: 'an unparseable timezone falls through to the venue and warns',
    input: {
      timezone: 'IST+5.30',
      place: IST_PLACE,
      startsAt: { structured: '2026-10-01T10:00:00' },
    },
    expect: {
      warnings: ['TIMEZONE_INVALID'],
      fields: { timezone: 'Asia/Kolkata', 'startsAt.at': at('2026-10-01T04:30:00.000Z') },
    },
  },
  {
    name: 'a bare abbreviation is not a timezone either',
    input: { timezone: 'EST', place: IST_PLACE, startsAt: { structured: '2026-10-01T10:00:00' } },
    expect: { warnings: ['TIMEZONE_INVALID'], fields: { timezone: 'Asia/Kolkata' } },
  },
  {
    name: 'a date-only registration deadline is the last instant of that IST day',
    input: { place: IST_PLACE, registrationDeadlineAt: { structured: '2026-09-27' } },
    expect: {
      fields: {
        'registrationDeadlineAt.at': at('2026-09-27T18:29:59.999Z'),
        'registrationDeadlineAt.precision': 'DATE',
      },
    },
  },
  {
    name: 'a date-only start is the first instant of that IST day',
    input: { place: IST_PLACE, startsAt: { structured: '2026-10-05' } },
    expect: {
      fields: { 'startsAt.at': at('2026-10-04T18:30:00.000Z'), 'startsAt.precision': 'DATE' },
    },
  },
  {
    name: 'a date-only submission deadline is also the end of the day',
    input: { place: IST_PLACE, submissionDeadlineAt: { structured: '2026-11-01' } },
    expect: { fields: { 'submissionDeadlineAt.at': at('2026-11-01T18:29:59.999Z') } },
  },
  {
    name: 'end before start drops both dates and warns',
    input: {
      place: IST_PLACE,
      startsAt: { structured: '2026-10-10T09:00:00' },
      endsAt: { structured: '2026-10-08T18:00:00' },
    },
    expect: { warnings: ['DATE_RANGE_INVALID'], absent: ['startsAt', 'endsAt'] },
  },
  {
    name: 'a start year far in the future is dropped, not corrected',
    input: { place: IST_PLACE, startsAt: { structured: '2087-04-01T09:00:00' } },
    expect: { warnings: ['DATE_OUT_OF_RANGE'], absent: ['startsAt'] },
  },
  {
    name: 'a date more than a year in the past is dropped too',
    input: { place: IST_PLACE, startsAt: { structured: '2019-04-01T09:00:00' } },
    expect: { warnings: ['DATE_OUT_OF_RANGE'], absent: ['startsAt'] },
  },
  {
    name: 'last year is still plausible, because listings lag',
    input: { place: IST_PLACE, startsAt: { structured: '2025-11-01T09:00:00' } },
    expect: { noWarnings: ['DATE_OUT_OF_RANGE'] },
  },
  {
    name: 'five years ahead is the edge of the window and is kept',
    input: { place: IST_PLACE, startsAt: { structured: '2031-06-01T09:00:00' } },
    expect: { noWarnings: ['DATE_OUT_OF_RANGE'] },
  },
  {
    name: 'a Unix seconds epoch is recognised by magnitude',
    input: { place: IST_PLACE, startsAt: { structured: 1_790_000_000 } },
    expect: { fields: { 'startsAt.at': 1_790_000_000_000, 'startsAt.precision': 'DATETIME' } },
  },
  {
    name: 'a Unix milliseconds epoch is taken as-is',
    input: { place: IST_PLACE, startsAt: { structured: 1_790_000_000_000 } },
    expect: { fields: { 'startsAt.at': 1_790_000_000_000 } },
  },
  {
    name: 'an ISO string with a Z is an instant, not a local reading',
    input: { place: IST_PLACE, startsAt: { structured: '2026-10-01T10:00:00Z' } },
    expect: { fields: { 'startsAt.at': at('2026-10-01T10:00:00.000Z') } },
  },
  {
    name: 'an ISO string with an offset keeps that offset',
    input: { place: IST_PLACE, startsAt: { structured: '2026-10-01T10:00:00+02:00' } },
    expect: { fields: { 'startsAt.at': at('2026-10-01T08:00:00.000Z') } },
  },
  {
    name: 'a month-only value keeps MONTH precision',
    input: { place: IST_PLACE, startsAt: { structured: '2026-11' } },
    expect: {
      fields: { 'startsAt.precision': 'MONTH', 'startsAt.at': at('2026-10-31T18:30:00.000Z') },
    },
  },
  {
    name: 'no timezone anywhere assumes UTC and lowers the precision',
    input: { startsAt: { structured: '2026-10-01T10:00:00' } },
    ctx: { sourceTimezone: undefined },
    expect: {
      warnings: ['TIMEZONE_ASSUMED'],
      absent: ['timezone'],
      // DATETIME dropped one step, because the zone was a guess.
      fields: { 'startsAt.precision': 'DATE' },
    },
  },
  {
    name: 'prose is read by chrono only when nothing structured was given',
    input: { place: IST_PLACE, startsAt: { text: 'Registration opens on 3 November 2026' } },
    expect: {
      fields: { 'startsAt.precision': 'DATE', 'startsAt.at': at('2026-11-02T18:30:00.000Z') },
    },
  },
  {
    name: 'a structured value wins over prose that disagrees',
    input: { place: IST_PLACE, startsAt: { structured: '2026-10-01', text: '15 December 2026' } },
    expect: { fields: { 'startsAt.at': at('2026-09-30T18:30:00.000Z') } },
  },
  {
    name: 'prose with a time keeps DATETIME precision',
    input: { place: IST_PLACE, startsAt: { text: 'starts 3 November 2026 at 10:30 am' } },
    expect: {
      fields: { 'startsAt.precision': 'DATETIME', 'startsAt.at': at('2026-11-03T05:00:00.000Z') },
    },
  },
  {
    name: 'prose that names no date at all is dropped with a warning',
    input: { place: IST_PLACE, startsAt: { text: 'to be announced' } },
    expect: { warnings: ['DATE_UNPARSEABLE'], absent: ['startsAt'] },
  },
  {
    name: 'a structured value that will not parse falls through to the prose',
    input: { place: IST_PLACE, startsAt: { structured: 'sometime soon', text: '3 November 2026' } },
    expect: {
      warnings: ['DATE_UNPARSEABLE'],
      fields: { 'startsAt.at': at('2026-11-02T18:30:00.000Z') },
    },
  },
  {
    name: 'a same-day start and end is a valid range',
    input: {
      place: IST_PLACE,
      startsAt: { structured: '2026-10-10T09:00:00' },
      endsAt: { structured: '2026-10-10T18:00:00' },
    },
    expect: { noWarnings: ['DATE_RANGE_INVALID'] },
  },
  {
    name: 'an exactly equal start and end is not an invalid range',
    input: {
      place: IST_PLACE,
      startsAt: { structured: '2026-10-10T09:00:00' },
      endsAt: { structured: '2026-10-10T09:00:00' },
    },
    expect: { noWarnings: ['DATE_RANGE_INVALID'] },
  },
  {
    name: 'a registration window opens at the start of a day and closes at the end',
    input: {
      place: IST_PLACE,
      registrationOpensAt: { structured: '2026-09-25' },
      registrationDeadlineAt: { structured: '2026-10-05' },
    },
    expect: {
      fields: {
        'registrationOpensAt.at': at('2026-09-24T18:30:00.000Z'),
        'registrationDeadlineAt.at': at('2026-10-05T18:29:59.999Z'),
      },
    },
  },
  {
    name: 'a result date is kept as its own field',
    input: { place: IST_PLACE, resultAt: { structured: '2026-12-01' } },
    expect: { fields: { 'resultAt.at': at('2026-11-30T18:30:00.000Z') } },
  },
  {
    name: 'a date-only deadline in UTC is 23:59:59.999 UTC',
    input: { timezone: 'UTC', registrationDeadlineAt: { structured: '2026-09-27' } },
    expect: { fields: { 'registrationDeadlineAt.at': at('2026-09-27T23:59:59.999Z') } },
  },
  {
    name: 'a zone that observes DST is read at the right side of the change',
    input: {
      timezone: 'America/New_York',
      startsAt: { structured: '2026-07-04T12:00:00' },
      endsAt: { structured: '2026-12-04T12:00:00' },
    },
    // EDT in July (−4), EST in December (−5).
    expect: {
      fields: {
        'startsAt.at': at('2026-07-04T16:00:00.000Z'),
        'endsAt.at': at('2026-12-04T17:00:00.000Z'),
      },
    },
  },
  {
    name: 'a date with no time and an assumed zone lands at MONTH precision',
    input: { startsAt: { structured: '2026-10-01' } },
    ctx: { sourceTimezone: undefined },
    expect: { warnings: ['TIMEZONE_ASSUMED'], fields: { 'startsAt.precision': 'MONTH' } },
  },
  {
    name: 'the raw text is kept for the provenance drawer',
    input: { place: IST_PLACE, startsAt: { structured: '2026-10-01T10:00:00' } },
    expect: { fields: { 'startsAt.raw': '2026-10-01T10:00:00' } },
  },
  {
    name: 'a structured date is full confidence',
    input: { place: IST_PLACE, startsAt: { structured: '2026-10-01' } },
    expect: { fields: { 'startsAt.confidence': 1 } },
  },
  {
    name: 'prose carries a lower confidence than a structured value',
    input: { place: IST_PLACE, startsAt: { text: '1 October 2026' } },
    expect: { lessThan: { 'startsAt.confidence': 1 } },
  },
  {
    name: 'an empty date input leaves the field absent without warning',
    input: { place: IST_PLACE, startsAt: { text: '' } },
    expect: { absent: ['startsAt'], noWarnings: ['DATE_UNPARSEABLE'] },
  },
];

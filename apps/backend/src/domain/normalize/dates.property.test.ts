import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { fixedClock, formatDay, offsetMinutesAt, toUtcInstant } from '../../platform/time.js';
import { CASE_NOW } from './cases/index.js';
import { combinedPrecision, parseDate, validateRange } from './dates.js';
import { WarningCollector } from './warnings.js';

/**
 * Property tests for the date layer (§4.15).
 *
 * The table in `cases/` says what happens to the inputs we thought of. These say
 * what must hold for inputs nobody thought of — which, for date handling across
 * timezones, is the larger and more dangerous set. fast-check shrinks a failure
 * to its smallest form, so a counter-example arrives as a date and a zone rather
 * than as a wall of output.
 */

const clock = fixedClock(CASE_NOW);

/**
 * Zones chosen to cover the cases that break naive arithmetic: a half-hour
 * offset, a three-quarter-hour one, both DST hemispheres, the date line on both
 * sides, and a zone that is a whole day ahead of another.
 */
const ZONES = [
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'UTC',
  'America/New_York',
  'Europe/London',
  'Australia/Sydney',
  'Pacific/Kiritimati',
  'Pacific/Niue',
  'America/Sao_Paulo',
  'Africa/Cairo',
] as const;

const zone = fc.constantFrom(...ZONES);

/** A plausible local date inside the window the normalizer accepts. */
const day = fc
  .date({
    min: new Date('2025-01-01T00:00:00Z'),
    max: new Date('2031-12-30T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((value) => ({
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  }));

const timeOfDay = fc.record({
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
});

describe('local ↔ UTC round-trips', () => {
  it('a wall-clock date in any zone survives local → UTC → local', () => {
    fc.assert(
      fc.property(day, zone, (parts, timeZone) => {
        // Midday, deliberately: it is the reading no DST transition can skip,
        // so this property is about the arithmetic and not about the gap rule,
        // which the case table tests on its own.
        const instant = toUtcInstant({ ...parts, hour: 12 }, timeZone);
        const back = formatDay(timeZone, instant);
        const expected = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
        expect(back).toBe(expected);
      }),
      { numRuns: 400 },
    );
  });

  it('the instant a zone reads as a wall clock is that wall clock, offset aside', () => {
    fc.assert(
      fc.property(day, timeOfDay, zone, (parts, time, timeZone) => {
        const instant = toUtcInstant({ ...parts, ...time }, timeZone);
        const offset = offsetMinutesAt(timeZone, instant);
        // The local reading is the instant plus the offset in force at it.
        const local = new Date(instant.getTime() + offset * 60_000);
        // A local time a spring-forward skipped resolves forward on purpose, so
        // the reading may be later than asked for — never earlier.
        const asked = Date.UTC(parts.year, parts.month - 1, parts.day, time.hour, time.minute);
        expect(local.getTime()).toBeGreaterThanOrEqual(asked);
        expect(local.getTime() - asked).toBeLessThanOrEqual(2 * 3_600_000);
      }),
      { numRuns: 400 },
    );
  });

  it('an offset is always a whole number of minutes within ±14 hours', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2024-01-01Z'),
          max: new Date('2032-01-01Z'),
          noInvalidDate: true,
        }),
        zone,
        (at, timeZone) => {
          const offset = offsetMinutesAt(timeZone, at);
          expect(Number.isInteger(offset)).toBe(true);
          expect(Math.abs(offset)).toBeLessThanOrEqual(14 * 60);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('a parsed range never ends before it starts', () => {
  const isoDay = day.map(
    (parts) =>
      `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
  );

  it('holds for any two dates in any zone', () => {
    fc.assert(
      fc.property(isoDay, isoDay, zone, (first, second, timeZone) => {
        const warnings = new WarningCollector();
        const options = {
          timezone: timeZone,
          clock,
          warnings,
          field: 'startsAt',
          dateOnlyMeans: 'START_OF_DAY' as const,
        };
        const range = validateRange(
          {
            startsAt: parseDate({ structured: first }, options),
            endsAt: parseDate(
              { structured: second },
              { ...options, field: 'endsAt', dateOnlyMeans: 'END_OF_DAY' },
            ),
          },
          warnings,
        );

        if (range.startsAt !== undefined && range.endsAt !== undefined) {
          expect(range.endsAt.at).toBeGreaterThanOrEqual(range.startsAt.at);
        }
        // An out-of-order pair is dropped whole — never silently reordered.
        if (range.startsAt === undefined && range.endsAt === undefined) {
          expect(warnings.has('DATE_RANGE_INVALID') || warnings.has('DATE_OUT_OF_RANGE')).toBe(
            true,
          );
        }
      }),
      { numRuns: 400 },
    );
  });

  it('the combined precision is never finer than either end', () => {
    const rank = { DATETIME: 0, DATE: 1, MONTH: 2, UNKNOWN: 3 } as const;
    fc.assert(
      fc.property(isoDay, isoDay, zone, (first, second, timeZone) => {
        const options = {
          timezone: timeZone,
          clock,
          field: 'startsAt',
          dateOnlyMeans: 'START_OF_DAY' as const,
        };
        const range = {
          startsAt: parseDate({ structured: first }, options),
          endsAt: parseDate({ structured: second }, { ...options, field: 'endsAt' }),
        };
        const combined = combinedPrecision(range);
        for (const end of [range.startsAt, range.endsAt]) {
          if (end !== undefined) {
            expect(rank[combined]).toBeGreaterThanOrEqual(rank[end.precision]);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

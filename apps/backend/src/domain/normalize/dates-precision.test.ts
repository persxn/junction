import { describe, expect, it } from 'vitest';

import { fromStructured, resolveTimezone, type ParseDateOptions } from './dates.js';

/**
 * Ruling R85: an explicit offset keeps its precision.
 *
 * When no zone can be found the library assumes UTC and lowers precision — but
 * only for a reading that *needed* the zone. An instant that carries `Z` or an
 * offset, or an epoch, is exact whatever zone was assumed. Before R85 every one
 * of them dropped to DATE, which is why CTFtime and CLIST passed `UTC` by hand.
 */

const clock = { now: () => new Date('2026-09-21T10:00:00.000Z') };

function assumed(): ParseDateOptions {
  const zone = resolveTimezone({});
  expect(zone.from).toBe('ASSUMED_UTC');
  return {
    clock,
    timezone: zone.timezone,
    field: 'startsAt',
    dateOnlyMeans: 'START_OF_DAY',
    lowerPrecision: zone.lowerPrecision,
  };
}

describe('R85 — an explicit offset is exact whatever zone was assumed', () => {
  it.each([
    ['Z', '2026-10-03T09:00:00Z'],
    ['+05:30', '2026-10-03T14:30:00+05:30'],
    ['+0000', '2026-10-03T09:00:00+0000'],
  ])('%s keeps DATETIME', (_label, text) => {
    const date = fromStructured(text, assumed());
    expect(date?.precision).toBe('DATETIME');
    expect(date?.at).toBe(Date.parse('2026-10-03T09:00:00Z'));
  });

  it('an epoch keeps DATETIME', () => {
    expect(fromStructured(1_791_018_000, assumed())?.precision).toBe('DATETIME');
  });

  it('a reading that needed the zone still drops a step', () => {
    expect(fromStructured('2026-10-03T09:00:00', assumed())?.precision).toBe('DATE');
    expect(fromStructured('2026-10-03', assumed())?.precision).toBe('MONTH');
  });

  it('with a real zone nothing is lowered at all', () => {
    const options = { ...assumed(), timezone: 'Asia/Kolkata', lowerPrecision: false };
    expect(fromStructured('2026-10-03T09:00:00', options)?.precision).toBe('DATETIME');
  });
});

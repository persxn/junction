import { describe, expect, it } from 'vitest';

import {
  advancingClock,
  APP_TIMEZONE,
  assertTimeZone,
  DATE_PRECISIONS,
  endOfDayIn,
  fixedClock,
  formatDay,
  isValidTimeZone,
  nowMs,
  offsetMinutesAt,
  parseDay,
  systemClock,
  toUtcInstant,
  zonedDayBounds,
} from './time.js';

const IST = APP_TIMEZONE;
/** A zone with DST, to prove the offset is read at an instant and not assumed. */
const NEW_YORK = 'America/New_York';

describe('clocks', () => {
  it('freezes time so a timestamp can be asserted on', () => {
    const clock = fixedClock('2026-09-27T10:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-27T10:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-27T10:00:00.000Z');
    expect(nowMs(clock)).toBe(Date.parse('2026-09-27T10:00:00.000Z'));
  });

  it('advances by a fixed step per read, so a duration is non-zero without sleeping', () => {
    const clock = advancingClock('2026-09-27T10:00:00.000Z', 250);
    const first = nowMs(clock);
    const second = nowMs(clock);
    expect(second - first).toBe(250);
    clock.set('2027-01-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects an unparseable instant rather than freezing at Invalid Date', () => {
    expect(() => fixedClock('yesterday')).toThrow(/parseable instant/);
  });

  it('gives the real time through systemClock', () => {
    const before = Date.now();
    const seen = nowMs(systemClock);
    expect(seen).toBeGreaterThanOrEqual(before);
    expect(seen).toBeLessThanOrEqual(Date.now());
  });

  it('makes every helper deterministic when the clock is fixed', () => {
    const clock = fixedClock('2026-09-27T10:00:00.000Z');
    expect(formatDay(IST, clock.now())).toBe('2026-09-27');
    expect(offsetMinutesAt(IST, clock.now())).toBe(330);
    expect(formatDay(IST, clock.now())).toBe(formatDay(IST, clock.now()));
  });
});

describe('time zones', () => {
  it('accepts real IANA names, including the aliases sources still use', () => {
    expect(isValidTimeZone(IST)).toBe(true);
    expect(isValidTimeZone('Asia/Calcutta')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects an unknown name instead of falling back to UTC', () => {
    expect(isValidTimeZone('Asia/Kolkatta')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Kolkata')).toBe(false);
    expect(() => assertTimeZone('Asia/Kolkatta')).toThrow(/Unknown IANA time zone: Asia\/Kolkatta/);
    expect(() => offsetMinutesAt('Asia/Kolkatta', new Date())).toThrow(/Unknown IANA time zone/);
  });

  it('rejects bare abbreviations, which ICU resolves to the wrong thing', () => {
    // ICU accepts these: `IST` becomes Asia/Calcutta (right by luck) and `EST`
    // becomes America/Panama — a fixed −05:00 zone with no DST at all. Taking
    // ICU's word for it would put every summer Eastern deadline an hour out.
    expect(
      new Intl.DateTimeFormat('en-US', { timeZone: 'EST' }).resolvedOptions().timeZone,
    ).not.toBe(NEW_YORK);
    expect(isValidTimeZone('IST')).toBe(false);
    expect(isValidTimeZone('EST')).toBe(false);
    expect(isValidTimeZone('CET')).toBe(false);
  });

  it('reads the offset at the given instant, not as a constant', () => {
    // India has had no DST since 1945, so IST is +05:30 all year.
    expect(offsetMinutesAt(IST, new Date('2026-01-15T00:00:00Z'))).toBe(330);
    expect(offsetMinutesAt(IST, new Date('2026-07-15T00:00:00Z'))).toBe(330);
    // New York moves, and the same function has to notice.
    expect(offsetMinutesAt(NEW_YORK, new Date('2026-01-15T12:00:00Z'))).toBe(-300);
    expect(offsetMinutesAt(NEW_YORK, new Date('2026-07-15T12:00:00Z'))).toBe(-240);
  });
});

describe('local days', () => {
  it('bounds an IST day at 18:30 UTC the previous day, exclusive at 18:30 the next', () => {
    const bounds = zonedDayBounds(IST, '2026-09-27');
    // 27 Sep 00:00 IST is 26 Sep 18:30 UTC — the previous UTC day.
    expect(bounds.startUtc.toISOString()).toBe('2026-09-26T18:30:00.000Z');
    expect(bounds.endUtcExclusive.toISOString()).toBe('2026-09-27T18:30:00.000Z');
  });

  it('is inclusive at both ends of the local day (A7)', () => {
    const { startUtc, endUtcExclusive } = zonedDayBounds(IST, '2026-09-27');
    // The first and last instants of 27 September IST are both inside the span.
    const lastInstant = new Date(endUtcExclusive.getTime() - 1);
    expect(formatDay(IST, startUtc)).toBe('2026-09-27');
    expect(formatDay(IST, lastInstant)).toBe('2026-09-27');
    // One millisecond outside either end belongs to a neighbouring day.
    expect(formatDay(IST, new Date(startUtc.getTime() - 1))).toBe('2026-09-26');
    expect(formatDay(IST, endUtcExclusive)).toBe('2026-09-28');
  });

  it('resolves a date-only deadline to the end of that day in the event timezone', () => {
    // §7.3 / ADR-0015: "register by 27 Sep" closes at 27 Sep 23:59:59.999 IST.
    const deadline = endOfDayIn(IST, '2026-09-27');
    expect(deadline.toISOString()).toBe('2026-09-27T18:29:59.999Z');
    expect(formatDay(IST, deadline)).toBe('2026-09-27');
    // The same calendar day in another zone is a different instant, on purpose.
    expect(endOfDayIn('UTC', '2026-09-27').toISOString()).toBe('2026-09-27T23:59:59.999Z');
  });

  it('handles a day that DST made 23 hours long', () => {
    // 8 March 2026 is the US spring-forward: 02:00 local never happens.
    const bounds = zonedDayBounds(NEW_YORK, '2026-03-08');
    const hours = (bounds.endUtcExclusive.getTime() - bounds.startUtc.getTime()) / 3_600_000;
    expect(hours).toBe(23);
    expect(formatDay(NEW_YORK, bounds.startUtc)).toBe('2026-03-08');
  });

  it('resolves a local time the spring-forward skipped forward, never backward', () => {
    // 02:30 on 8 March 2026 does not exist in New York. The naive two-pass
    // answer would be 01:30 EST — an hour *early*, which for a deadline is the
    // one direction that loses entries. It resolves to the transition instead.
    const instant = toUtcInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NEW_YORK);
    expect(instant.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(formatDay(NEW_YORK, instant)).toBe('2026-03-08');
    // A real 02:30 the day before and the day after is untouched by that path.
    expect(
      toUtcInstant({ year: 2026, month: 3, day: 7, hour: 2, minute: 30 }, NEW_YORK).toISOString(),
    ).toBe('2026-03-07T07:30:00.000Z');
    expect(
      toUtcInstant({ year: 2026, month: 3, day: 9, hour: 2, minute: 30 }, NEW_YORK).toISOString(),
    ).toBe('2026-03-09T06:30:00.000Z');
  });

  it('takes the earlier instant when a fall-back repeats a local reading', () => {
    // 01:30 on 1 November 2026 happens twice in New York; the first one wins.
    const instant = toUtcInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NEW_YORK);
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('round-trips toUtcInstant → formatDay across a whole year', () => {
    for (const zone of [IST, NEW_YORK, 'UTC', 'Pacific/Kiritimati']) {
      const start = new Date(Date.UTC(2026, 0, 1));
      for (let offset = 0; offset < 365; offset += 1) {
        const at = new Date(start.getTime() + offset * 86_400_000);
        const day = formatDay(zone, at);
        const { year, month, day: dayOfMonth } = parseDay(day);
        const midday = toUtcInstant({ year, month, day: dayOfMonth, hour: 12 }, zone);
        expect(formatDay(zone, midday)).toBe(day);
      }
    }
  });

  it('rejects a malformed or impossible day', () => {
    expect(() => parseDay('2026-9-27')).toThrow(/YYYY-MM-DD/);
    expect(() => parseDay('27-09-2026')).toThrow(/YYYY-MM-DD/);
    expect(() => parseDay('2026-02-30')).toThrow(/real calendar day/);
    expect(() => parseDay('2026-13-01')).toThrow(/real calendar day/);
    expect(() => zonedDayBounds(IST, 'soon')).toThrow(/YYYY-MM-DD/);
  });

  it('crosses a month and a year boundary without arithmetic of its own', () => {
    expect(zonedDayBounds(IST, '2026-12-31').endUtcExclusive.toISOString()).toBe(
      '2026-12-31T18:30:00.000Z',
    );
    expect(formatDay(IST, endOfDayIn(IST, '2026-12-31'))).toBe('2026-12-31');
    expect(formatDay(IST, zonedDayBounds(IST, '2026-02-28').endUtcExclusive)).toBe('2026-03-01');
  });
});

describe('date precision', () => {
  it('re-exports the contracts enum so the column and the normalizer cannot drift', () => {
    expect(DATE_PRECISIONS).toStrictEqual(['DATETIME', 'DATE', 'MONTH', 'UNKNOWN']);
  });
});

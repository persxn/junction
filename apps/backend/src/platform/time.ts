/**
 * The one time layer (§6.1, §7.3, ADR-0015).
 *
 * Two things live here and nowhere else. First, *what time is it* — every piece
 * of code that needs the answer takes a {@link Clock} instead of calling
 * `Date.now()`, so a test can decide what "now" means without touching the
 * global clock or sleeping. Second, *what a local date means* — M1 is roughly
 * half date logic, and "the deadline is the end of 27 September in Asia/Kolkata"
 * must be computed one way, not once per adapter.
 *
 * There is no dependency here. Timezone arithmetic goes through
 * `Intl.DateTimeFormat`, which ships with Node and carries the IANA database, so
 * a zone whose rules changed is corrected by a Node upgrade rather than by a
 * package bump we have to remember.
 *
 * Storage stays as §6.1 fixes it: INTEGER Unix milliseconds, UTC. Nothing in
 * here persists a local time; zones are used to *interpret* what a source said
 * and to *display* what we stored.
 */

/**
 * `DatePrecision` is contracts' — it is a column enum and a DTO field — and is
 * re-exported here so that date code has one import and `events.date_precision`
 * and the normalizer cannot drift apart.
 */
export { DATE_PRECISIONS, DatePrecision } from '@compintel/contracts';

/** Where a source of "now" comes from. The only shape the codebase uses. */
export interface Clock {
  now(): Date;
}

/** The real clock. Production wiring passes this and nothing else. */
export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

/** Milliseconds since the epoch, for the many callers that store or compare ints. */
export function nowMs(clock: Clock): number {
  return clock.now().getTime();
}

function parseInstant(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new TypeError(`Not a parseable instant: ${iso}`);
  }
  return ms;
}

/** A clock frozen at one instant — the default for a test that asserts on a timestamp. */
export function fixedClock(iso: string): Clock {
  const ms = parseInstant(iso);
  return {
    now(): Date {
      return new Date(ms);
    },
  };
}

/**
 * A clock that moves `stepMs` forward on every read. Useful where code reads the
 * time twice and a frozen clock would make a duration zero, without any real
 * waiting: a test that sleeps is a test that will one day be flaky.
 */
export function advancingClock(iso: string, stepMs: number): Clock & { set(iso: string): void } {
  let current = parseInstant(iso);
  return {
    now(): Date {
      const at = current;
      current += stepMs;
      return new Date(at);
    },
    set(next: string): void {
      current = parseInstant(next);
    },
  };
}

/** Display timezone (§6.1, ruling A7). A setting later; the default is not. */
export const APP_TIMEZONE = 'Asia/Kolkata';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/**
 * `Area/Location`, the shape of an IANA identifier. `UTC` is the one bare name
 * allowed, because it is unambiguous and is what the spec's fallback names.
 */
const IANA_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/;

/**
 * Is this a timezone we are willing to interpret?
 *
 * An unknown name is **rejected**, never quietly treated as UTC (§7.3): silently
 * storing the wrong offset moves every deadline by hours with nothing on screen
 * to show for it. A typo like `Asia/Kolkatta` fails on its own, because ICU
 * throws.
 *
 * Bare abbreviations are rejected too, and that is the part worth knowing.
 * ICU *accepts* them and resolves them to something plausible-looking: on this
 * Node, `IST` becomes `Asia/Calcutta` — right by luck — but `EST` becomes
 * `America/Panama`, a fixed −05:00 zone that never observes DST. A source that
 * said "EST" would then have every summer deadline an hour late, and nothing
 * anywhere would look wrong. Abbreviations are ambiguous by nature (IST is
 * India, Ireland and Israel), so they are a normalization decision for the
 * adapter to make explicitly, not something this layer guesses at.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone !== 'UTC' && !IANA_NAME_PATTERN.test(timeZone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The same check as a guard: returns the zone, or throws naming it. */
export function assertTimeZone(timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Unknown IANA time zone: ${timeZone}`);
  }
  return timeZone;
}

/** The wall-clock fields a local date/time is made of. Month is 1-based. */
export interface ZonedParts {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  readonly day: number;
  readonly hour?: number;
  readonly minute?: number;
  readonly second?: number;
  readonly millisecond?: number;
}

/** The wall-clock reading a zone shows at an instant, as UTC-shaped milliseconds. */
function wallClockMs(timeZone: string, instant: Date): number {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((part) => part.type === type);
    if (found === undefined) {
      throw new RangeError(`Time zone ${timeZone} produced no ${type} field`);
    }
    return found.value;
  };
  const year = Number(field('year'));
  // `hour12: false` still renders midnight as 24 in some ICU versions.
  const hour = Number(field('hour')) % 24;
  return utcFromParts({
    year,
    month: Number(field('month')),
    day: Number(field('day')),
    hour,
    minute: Number(field('minute')),
    second: Number(field('second')),
    millisecond: instant.getUTCMilliseconds(),
  });
}

/**
 * `Date.UTC` with the two-digit-year trap disarmed: it maps 0–99 into the 1900s,
 * which would silently move a date by a century rather than fail loudly.
 */
function utcFromParts(parts: ZonedParts): number {
  const utc = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour ?? 0,
      parts.minute ?? 0,
      parts.second ?? 0,
      parts.millisecond ?? 0,
    ),
  );
  if (parts.year >= 0 && parts.year <= 99) {
    utc.setUTCFullYear(parts.year);
  }
  return utc.getTime();
}

/**
 * Minutes east of UTC that `timeZone` is at `instant` — +330 for IST, and for a
 * zone with DST the answer depends on when you ask, which is exactly why this
 * takes an instant rather than being a constant.
 */
export function offsetMinutesAt(timeZone: string, instant: Date): number {
  assertTimeZone(timeZone);
  return (wallClockMs(timeZone, instant) - instant.getTime()) / 60_000;
}

/**
 * The UTC instant at which `timeZone` reads these wall-clock fields.
 *
 * Two passes: guess with the offset in force at the naive instant, then correct
 * with the offset actually in force at the guess. That settles every zone whose
 * offset changes, because a DST shift moves the answer by at most an hour and
 * the second pass is computed on the right side of the boundary. Where a
 * fall-back makes one local reading happen twice, the earlier instant wins.
 *
 * A local time that a spring-forward skipped has no instant at all, and the two
 * passes then land *before* the gap — 02:30 would silently become 01:30. That is
 * caught and resolved forward instead, to the first instant at which the zone's
 * clock has reached the requested reading, which for a deadline is the only
 * answer that cannot be early.
 */
export function toUtcInstant(parts: ZonedParts, timeZone: string): Date {
  assertTimeZone(timeZone);
  const naive = utcFromParts(parts);
  const firstOffset = offsetMinutesAt(timeZone, new Date(naive));
  const guess = naive - firstOffset * 60_000;
  const secondOffset = offsetMinutesAt(timeZone, new Date(guess));
  const candidate = naive - secondOffset * 60_000;
  if (wallClockMs(timeZone, new Date(candidate)) === naive) {
    return new Date(candidate);
  }
  return new Date(firstInstantReaching(timeZone, naive, candidate, guess));
}

/**
 * The smallest instant in `(low, high]` whose local reading is at least `naive`.
 *
 * Only reached inside a DST gap, where the local clock jumps forward and is
 * therefore monotonic across the span, so a bisection is well defined. The span
 * is one offset change wide — an hour in practice — so this converges to the
 * millisecond in about two dozen steps and never runs on the normal path.
 */
function firstInstantReaching(timeZone: string, naive: number, low: number, high: number): number {
  let before = low;
  let after = high;
  while (after - before > 1) {
    const middle = before + Math.floor((after - before) / 2);
    if (wallClockMs(timeZone, new Date(middle)) < naive) {
      before = middle;
    } else {
      after = middle;
    }
  }
  return after;
}

/** `YYYY-MM-DD`, the only date-only shape this codebase accepts. */
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DayParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Splits `YYYY-MM-DD`, rejecting both the wrong shape and an impossible date. */
export function parseDay(day: string): DayParts {
  const match = DAY_PATTERN.exec(day);
  if (match === null) {
    throw new TypeError(`Not a YYYY-MM-DD day: ${day}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== dayOfMonth
  ) {
    throw new TypeError(`Not a real calendar day: ${day}`);
  }
  return { year, month, day: dayOfMonth };
}

/** Half-open UTC span covering one whole local day. */
export interface DayBounds {
  /** The first instant of the local day. */
  readonly startUtc: Date;
  /** The first instant of the *next* local day — exclusive. */
  readonly endUtcExclusive: Date;
}

/**
 * The inclusive local day `YYYY-MM-DD` in `timeZone`, as `[startUtc, endUtcExclusive)`.
 *
 * Half-open on purpose. "Events on 27 September" is `start >= X && start < Y`,
 * which needs no millisecond fudging, stays correct whatever precision a source
 * gave, and does not double-count an event at exactly midnight. A day that DST
 * made 23 or 25 hours long is handled because both ends are resolved
 * independently.
 */
export function zonedDayBounds(timeZone: string, day: string): DayBounds {
  const { year, month, day: dayOfMonth } = parseDay(day);
  const startUtc = toUtcInstant({ year, month, day: dayOfMonth }, timeZone);
  const nextDay = new Date(Date.UTC(year, month - 1, dayOfMonth + 1));
  const endUtcExclusive = toUtcInstant(
    {
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
    },
    timeZone,
  );
  return { startUtc, endUtcExclusive };
}

/**
 * What a date-only deadline means (§7.3, ADR-0015): the last instant of that
 * local day. "Register by 27 Sep" closes at 27 Sep 23:59:59.999 in the event's
 * timezone, and the UI shows "27 Sep (time not stated)".
 */
export function endOfDayIn(timeZone: string, day: string): Date {
  return new Date(zonedDayBounds(timeZone, day).endUtcExclusive.getTime() - 1);
}

/** Which local day `instant` falls on in `timeZone`, as `YYYY-MM-DD`. */
export function formatDay(timeZone: string, instant: Date): string {
  assertTimeZone(timeZone);
  const local = new Date(wallClockMs(timeZone, instant));
  const year = String(local.getUTCFullYear()).padStart(4, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

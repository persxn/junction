import type { CandidateSeries, EventType, Recurrence } from '@compintel/contracts';

/**
 * Series and recurring-round detection (§7.3 "Recurring rounds", D-08, WP-11).
 * Pure: no database, no network; the siblings arrive as an argument.
 *
 * Two kinds of repetition look alike and must never be confused:
 *
 * - a **round** — Codeforces Round 975, LeetCode Weekly Contest 412 — is one
 *   instalment of a rated series. It moves to the Contest Calendar and out of
 *   the main feed;
 * - a **yearly edition** — HackX 2026 — is the same event again a year later.
 *   It stays in the feed, it is `YEARLY`, and §7.5 never merges across years.
 *
 * The rules run in order: the platform table, title patterns, cadence over the
 * siblings, yearly editions, otherwise nothing. A hackathon, ideathon or CTF is
 * never a round, whatever platform lists it.
 */

export interface SeriesSubject {
  readonly title: string;
  readonly eventType: EventType;
  /** The platform host, e.g. `codeforces.com`. */
  readonly resource?: string | undefined;
  readonly startsAt?: number | undefined;
}

/** `CandidateSeries` minus the fields a non-series event has no value for. */
export type SeriesResult =
  | CandidateSeries
  | { readonly isRecurringRound: false; readonly recurrence: 'NONE'; readonly confidence: number };

/** Rule a: platforms that publish numbered rated rounds. */
export const ROUND_PLATFORMS: readonly string[] = [
  'codeforces.com',
  'leetcode.com',
  'atcoder.jp',
  'codechef.com',
  'topcoder.com',
  'hackerrank.com',
];

/** Event types that are one-offs by nature (rule d). */
const NEVER_ROUNDS: ReadonlySet<EventType> = new Set([
  'HACKATHON',
  'IDEATHON',
  'CTF',
  'INNOVATION_CHALLENGE',
]);

/** Rule b: title shapes that name one instalment; group 1 is the series, group 2 the ordinal. */
const ROUND_PATTERNS: readonly RegExp[] = [
  /^(educational codeforces round)\s*#?\s*(\d+)/i,
  /^(codeforces (?:global )?round)\s*#?\s*(\d+)/i,
  /^((?:bi)?weekly contest)\s*#?\s*(\d+)/i,
  /^(atcoder (?:beginner|regular|grand|heuristic) contest)\s*#?\s*(\d+)/i,
  /^((?:codechef )?starters)\s*#?\s*(\d+)/i,
  /^(.*?\bround)\s*#?\s*(\d+)/i,
];

/** A 4-digit year a title can carry (A11's window). */
const YEAR = /\b(20[2-9]\d|2100)\b/;

const DAY_MS = 86_400_000;

function hostOf(resource: string | undefined): string | undefined {
  return resource
    ?.trim()
    .toLowerCase()
    .replace(/^www\./, '');
}

/** "Codeforces Round 975 (Div. 2)" → "codeforces round div": lower-case, letters only. */
export function seriesKeyOf(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The title with its ordinal removed, for display. */
function withoutOrdinal(title: string, ordinal: string): string {
  return title
    .replace(new RegExp(`#?\\s*${ordinal}\\b`), '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([)\]])/g, '$1')
    .trim();
}

interface Round {
  readonly key: string;
  readonly name: string;
  readonly roundLabel?: string;
  readonly confidence: number;
}

/** Rules a and b: is this one instalment, and of which series? */
function roundOf(subject: SeriesSubject): Round | undefined {
  if (NEVER_ROUNDS.has(subject.eventType)) {
    return undefined;
  }
  const title = subject.title.trim();
  const onPlatform = ROUND_PLATFORMS.includes(hostOf(subject.resource) ?? '');
  for (const pattern of ROUND_PATTERNS) {
    const match = pattern.exec(title);
    const ordinal = match?.[2];
    if (match !== null && ordinal !== undefined) {
      const name = withoutOrdinal(title, ordinal);
      // The generic "... Round N" shape alone is weak; on a round platform it is not.
      const generic = pattern === ROUND_PATTERNS[ROUND_PATTERNS.length - 1];
      if (generic && !onPlatform) {
        continue;
      }
      return {
        key: seriesKeyOf(name),
        name,
        roundLabel: ordinal,
        confidence: onPlatform ? 0.95 : 0.85,
      };
    }
  }
  if (onPlatform) {
    // A named one-off on a rated platform ("Good Bye 2026") is still a rated
    // round; its series is its own name, digits removed.
    const name = title.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
    return name.length === 0 ? undefined : { key: seriesKeyOf(name), name, confidence: 0.7 };
  }
  return undefined;
}

/**
 * Rule c: the cadence of a family, from the starts of every sibling in it
 * (self included). Fewer than three instalments is IRREGULAR — two points do
 * not make a schedule.
 */
export function inferCadence(starts: readonly number[]): Recurrence {
  const sorted = [...new Set(starts)].sort((a, b) => a - b);
  if (sorted.length < 3) {
    return 'IRREGULAR';
  }
  const gaps = sorted.slice(1).map((at, index) => (at - (sorted[index] ?? at)) / DAY_MS);
  const near = (target: number, slack: number): boolean =>
    gaps.every((gap) => Math.abs(gap - target) <= slack);
  if (near(7, 1.5)) {
    return 'WEEKLY';
  }
  if (near(14, 2)) {
    return 'BIWEEKLY';
  }
  if (near(30, 4)) {
    return 'MONTHLY';
  }
  return 'IRREGULAR';
}

/** Detects the series of `subject`, using `siblings` from the same listing for cadence. */
export function detectSeries(
  subject: SeriesSubject,
  siblings: readonly SeriesSubject[] = [],
): SeriesResult {
  const round = roundOf(subject);
  if (round !== undefined) {
    const family = [subject, ...siblings.filter((sibling) => sibling !== subject)]
      .filter((member) => roundOf(member)?.key === round.key)
      .map((member) => member.startsAt)
      .filter((at): at is number => at !== undefined);
    return {
      key: round.key,
      name: round.name,
      recurrence: inferCadence(family),
      isRecurringRound: true,
      ...(round.roundLabel === undefined ? {} : { roundLabel: round.roundLabel }),
      confidence: round.confidence,
    };
  }

  // Rule e: a yearly edition is a series, never a round.
  const year = YEAR.exec(subject.title);
  if (year !== null) {
    const name = subject.title
      .replace(YEAR, '')
      .replace(/\s+/g, ' ')
      .replace(/[\s,–—-]+$/, '')
      .trim();
    const key = seriesKeyOf(name);
    if (key.length > 0) {
      return { key, name, recurrence: 'YEARLY', isRecurringRound: false, confidence: 0.8 };
    }
  }

  // Rule d.
  return { isRecurringRound: false, recurrence: 'NONE', confidence: 1 };
}

/** The `CandidateSeries` to store, or `undefined` for an event that belongs to none. */
export function asCandidateSeries(result: SeriesResult): CandidateSeries | undefined {
  return 'key' in result ? result : undefined;
}

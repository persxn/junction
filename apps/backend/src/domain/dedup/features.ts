import type { EventMode } from '@compintel/contracts';

import { tokenSetRatio } from './title.js';

/**
 * §7.5's other three features and its URL rule. Pure; every function answers
 * 0–1 and answers 0 when there is nothing to compare — an absent organizer is
 * not evidence that two events share one.
 */

const DAY_MS = 86_400_000;

/** §7.5: starts within ±3 days, registration deadlines within ±2 days. */
export const START_WINDOW_MS = 3 * DAY_MS;
export const DEADLINE_WINDOW_MS = 2 * DAY_MS;

/** Words that dress up an organizer's name without naming it. */
const ORGANIZER_FILLER = new Set(['the', 'team', 'club', 'of', 'and', 'inc', 'ltd', 'pvt']);

function organizerTokens(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((token) => token.length > 0 && !ORGANIZER_FILLER.has(token));
}

export function organizerSimilarity(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  if (left == null || right == null) {
    return 0;
  }
  return tokenSetRatio(organizerTokens(left), organizerTokens(right));
}

/** 1 at the same instant, falling linearly to 0 at the edge of the window. */
function closeness(
  a: number | null | undefined,
  b: number | null | undefined,
  window: number,
): number {
  if (a == null || b == null) {
    return 0;
  }
  return Math.max(0, 1 - Math.abs(a - b) / window);
}

export interface Dated {
  readonly startsAt?: number | null | undefined;
  readonly registrationDeadlineAt?: number | null | undefined;
}

/** §7.5's date feature: the better of the start and deadline closeness. */
export function dateProximity(left: Dated, right: Dated): number {
  return Math.max(
    closeness(left.startsAt, right.startsAt, START_WINDOW_MS),
    closeness(left.registrationDeadlineAt, right.registrationDeadlineAt, DEADLINE_WINDOW_MS),
  );
}

/** §7.5's candidate test: starts within ±3 days or deadlines within ±2 days. */
export function datesOverlap(left: Dated, right: Dated): boolean {
  const within = (
    a: number | null | undefined,
    b: number | null | undefined,
    window: number,
  ): boolean => a != null && b != null && Math.abs(a - b) <= window;
  return (
    within(left.startsAt, right.startsAt, START_WINDOW_MS) ||
    within(left.registrationDeadlineAt, right.registrationDeadlineAt, DEADLINE_WINDOW_MS)
  );
}

export interface Placed {
  readonly mode: EventMode;
  readonly city?: string | null | undefined;
  readonly countryCode?: string | null | undefined;
}

function modeAgreement(a: EventMode, b: EventMode): number {
  if (a === 'UNKNOWN' || b === 'UNKNOWN') {
    return 0.5;
  }
  if (a === b) {
    return 1;
  }
  return a === 'HYBRID' || b === 'HYBRID' ? 0.5 : 0;
}

function placeAgreement(left: Placed, right: Placed): number {
  const cityA = left.city?.trim().toLowerCase();
  const cityB = right.city?.trim().toLowerCase();
  if (left.countryCode != null && right.countryCode != null) {
    if (left.countryCode !== right.countryCode) {
      return 0;
    }
    if (cityA && cityB) {
      return cityA === cityB ? 1 : 0.5;
    }
    return 0.5;
  }
  if (cityA && cityB) {
    return cityA === cityB ? 1 : 0;
  }
  return 0.5;
}

/**
 * §7.5's location/mode feature, mode first: two modes that contradict each
 * other score 0 whatever the places say. Two online events have no place to
 * compare and agree fully; otherwise mode and place count half each, and an
 * unknown on either side is half credit rather than a guess either way.
 */
export function locationModeAgreement(left: Placed, right: Placed): number {
  const mode = modeAgreement(left.mode, right.mode);
  if (mode === 0) {
    return 0;
  }
  if (left.mode === 'ONLINE' && right.mode === 'ONLINE') {
    return 1;
  }
  return (mode + placeAgreement(left, right)) / 2;
}

/**
 * A URL in the form two sources would agree on: https, no `www.`, lower-case
 * host, no fragment, no trailing slash. `undefined` for anything unparsable.
 * The query is kept — `?id=12` and `?id=13` are different events.
 */
export function comparableUrl(value: string | null | undefined): string | undefined {
  if (value == null || value.trim() === '') {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  return `https://${host}${url.port === '' ? '' : `:${url.port}`}${path}${url.search}`;
}

export interface Linked {
  readonly officialUrl?: string | null | undefined;
  readonly registrationUrl?: string | null | undefined;
}

/** §7.5: an identical normalized official or registration URL, on either side. */
export function urlMatch(left: Linked, right: Linked): boolean {
  const mine = [comparableUrl(left.officialUrl), comparableUrl(left.registrationUrl)].filter(
    (url): url is string => url !== undefined,
  );
  if (mine.length === 0) {
    return false;
  }
  const theirs = new Set(
    [comparableUrl(right.officialUrl), comparableUrl(right.registrationUrl)].filter(
      (url): url is string => url !== undefined,
    ),
  );
  return mine.some((url) => theirs.has(url));
}

/**
 * The stored spellings a comparable URL could have, for the repository's
 * indexed `IN (...)` prefilter. The domain decides what "the same URL" means;
 * the database only narrows the rows it has to show us.
 */
export function urlSpellings(value: string | null | undefined): string[] {
  const base = comparableUrl(value);
  if (base === undefined) {
    return [];
  }
  const rest = base.slice('https://'.length);
  const out: string[] = [];
  for (const scheme of ['https://', 'http://']) {
    for (const www of ['', 'www.']) {
      for (const slash of ['', '/']) {
        out.push(`${scheme}${www}${rest}${rest.includes('?') ? '' : slash}`);
      }
    }
  }
  return [...new Set(out)];
}

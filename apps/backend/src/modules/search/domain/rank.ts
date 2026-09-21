import type {
  DatePrecision,
  EventMode,
  RelevanceReason,
  RelevanceReasonCode,
  SearchSort,
} from '@compintel/contracts';

import { formatDistanceKm } from '../../../domain/geo/distance.js';
import { formatDay } from '../../../platform/time.js';
import type { RankingThresholds, RankingWeights } from '../settings.js';

/**
 * Deterministic, explainable ranking (§8.4, D-18, WP-15b step 5). Pure: a row's
 * facts and the query's context in, a score and its reasons out.
 *
 * The score is the sum of the reasons' points, so the list the professor reads
 * *is* the arithmetic — no hidden term. Every result carries at least one
 * reason: a non-RELEVANCE sort always states its sort key (`SORT_KEY`), and a
 * RELEVANCE result that fires no boost states the deadline its tie-break used.
 * The contract (`reasons.min(1)`) makes an empty list unserializable besides.
 */

export const DAY_MS = 86_400_000;

export interface RankRow {
  readonly id: string;
  readonly mode: EventMode;
  readonly registrationOpensAt: number | null;
  readonly registrationDeadlineAt: number | null;
  readonly registrationDeadlinePrecision: DatePrecision;
  readonly startsAt: number | null;
  readonly datePrecision: DatePrecision;
  readonly distanceKm: number | null;
  readonly teamMin: number | null;
  readonly teamMax: number | null;
  readonly prizeTotalMinor: number | null;
  readonly prizeCurrency: string | null;
  readonly hasConflicts: boolean;
  readonly firstSeenAt: number;
  /** bm25 (negative, lower is better); 0 for a substring-only hit; null without text. */
  readonly textScore: number | null;
  /**
   * The name of the most trusted source listing it, when that source clears
   * `trustedSourceMinRank` (the caller applies the threshold; the score path
   * passes '' because it prints nothing).
   */
  readonly trustedSource: string | undefined;
  /** Names of the event's categories that are among the professor's interests, sorted. */
  readonly interestCategories: readonly string[];
  /** Names of the event's tags that are among the professor's interests, sorted. */
  readonly interestTags: readonly string[];
}

export interface RankContext {
  readonly now: number;
  readonly timeZone: string;
  readonly weights: RankingWeights;
  readonly thresholds: RankingThresholds;
  readonly sort: SearchSort;
  /** The text as searched (after any correction). */
  readonly text?: string | undefined;
  /** The best (most negative) bm25 in the whole result set. */
  readonly bestTextScore?: number | undefined;
  /** `maxDistanceKm`, or the preferred radius when the query has none. */
  readonly radiusKm?: number | undefined;
  readonly teamSizeFits?: number | undefined;
}

export interface Ranked {
  readonly score: number;
  readonly reasons: RelevanceReason[];
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Fixed, not `Intl`: ICU's en-GB says "Sept", and §8.4's examples say "27 Sep". */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27 Sep", "27 Sep 2027" in another year, "Sep 2026" for a month-precision date. */
export function formatDate(at: number, precision: DatePrecision, context: RankContext): string {
  const [year, month, day] = formatDay(context.timeZone, new Date(at)).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const monthName = MONTHS[month - 1] ?? '';
  if (precision === 'MONTH') return `${monthName} ${String(year)}`;
  const [nowYear] = formatDay(context.timeZone, new Date(context.now)).split('-').map(Number);
  return `${String(day)} ${monthName}${year === nowYear ? '' : ` ${String(year)}`}`;
}

/** Whole local days from today to `at`'s day (0 = today). */
function daysUntil(at: number, context: RankContext): number {
  const day = (instant: number): number =>
    Date.parse(`${formatDay(context.timeZone, new Date(instant))}T00:00:00Z`);
  return Math.round((day(at) - day(context.now)) / DAY_MS);
}

function teamText(min: number | null, max: number | null): string {
  if (min !== null && max !== null)
    return min === max ? `Team of ${String(min)}` : `Team size ${String(min)}–${String(max)}`;
  if (max !== null) return `Team size up to ${String(max)}`;
  return `Team size ${String(min ?? 1)}+`;
}

function prizeText(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);
  } catch {
    return `${currency} ${String(Math.round(minor / 100))}`;
  }
}

function addedText(firstSeenAt: number, context: RankContext): string {
  const days = -daysUntil(firstSeenAt, context);
  return days <= 0
    ? 'Added today'
    : days === 1
      ? 'Added yesterday'
      : `Added ${String(days)} days ago`;
}

/** The sentence for the registration deadline, as a sort key. */
function deadlineText(row: RankRow, context: RankContext): string {
  if (row.registrationDeadlineAt === null) return 'Registration deadline not announced';
  const date = formatDate(row.registrationDeadlineAt, row.registrationDeadlinePrecision, context);
  return row.registrationDeadlineAt < context.now
    ? `Registration closed ${date}`
    : `Registration closes ${date}`;
}

function sortKeyText(row: RankRow, context: RankContext): string {
  switch (context.sort) {
    case 'START':
      if (row.startsAt === null) return 'Start date not announced';
      return `${row.startsAt < context.now ? 'Started' : 'Starts'} ${formatDate(row.startsAt, row.datePrecision, context)}`;
    case 'DISTANCE':
      if (row.distanceKm !== null) return formatDistanceKm(row.distanceKm);
      return row.mode === 'ONLINE' ? 'Online' : 'Distance unknown';
    case 'PRIZE':
      return row.prizeTotalMinor === null || row.prizeCurrency === null
        ? 'No prize amount stated'
        : `Prize ${prizeText(row.prizeTotalMinor, row.prizeCurrency)}`;
    case 'NEWEST':
      return `First listed ${formatDate(row.firstSeenAt, 'DATE', context)}`;
    case 'DEADLINE':
    case 'RELEVANCE':
      return deadlineText(row, context);
  }
}

/**
 * The boosts that fire, in the order the UI lists them, each handed to `add`
 * with its sentence as a thunk: the score path never renders one (date
 * formatting is the expensive part) and allocates nothing. Both paths add the
 * same weights, so a score never depends on whether its row was on the page.
 */
type Emit = (code: RelevanceReasonCode, text: () => string, weight: number) => void;

function boosts(row: RankRow, context: RankContext, add: Emit): void {
  const { weights, thresholds } = context;

  if (row.textScore !== null && context.text !== undefined) {
    const best = context.bestTextScore ?? 0;
    const share = row.textScore < 0 && best < 0 ? Math.min(1, row.textScore / best) : 0;
    add('TEXT_MATCH', () => `Matches “${String(context.text)}”`, weights.text * share);
  }

  const deadline = row.registrationDeadlineAt;
  const notOpenYet = row.registrationOpensAt !== null && row.registrationOpensAt > context.now;
  if (deadline !== null && !notOpenYet && deadline >= context.now) {
    const closingSoonUntil = context.now + thresholds.closingSoonDays * DAY_MS;
    const date = (): string => formatDate(deadline, row.registrationDeadlinePrecision, context);
    if (deadline <= closingSoonUntil) {
      const when = (): string => {
        const days = daysUntil(deadline, context);
        return days <= 0
          ? 'today'
          : days === 1
            ? `tomorrow (${date()})`
            : `in ${String(days)} days (${date()})`;
      };
      add('CLOSING_SOON', () => `Registration closes ${when()}`, weights.closingSoon);
    } else {
      add('REGISTRATION_OPEN', () => `Registration open until ${date()}`, weights.registrationOpen);
    }
  }

  const km = row.distanceKm;
  if (km !== null && context.radiusKm !== undefined && km <= context.radiusKm) {
    add('WITHIN_RADIUS', () => formatDistanceKm(km), weights.withinRadius);
  }

  if (row.interestCategories.length > 0) {
    const verb = row.interestCategories.length === 1 ? 'matches' : 'match';
    add(
      'CATEGORY_MATCH',
      () => `${row.interestCategories.join(', ')} ${verb} your interests`,
      weights.categoryMatch,
    );
  }
  if (row.interestTags.length > 0) {
    add(
      'TAG_MATCH',
      () => `Tagged ${row.interestTags.join(', ')}, one of your interests`,
      weights.tagMatch,
    );
  }

  const n = context.teamSizeFits;
  if (
    n !== undefined &&
    (row.teamMin !== null || row.teamMax !== null) &&
    (row.teamMin ?? 1) <= n &&
    (row.teamMax ?? n) >= n
  ) {
    add('TEAM_SIZE_FITS', () => `${teamText(row.teamMin, row.teamMax)} fits`, weights.teamSizeFits);
  }

  const source = row.trustedSource;
  if (source !== undefined) {
    add('TRUSTED_SOURCE', () => `Listed on ${source}`, weights.trustedSource);
  }
  if (!row.hasConflicts) {
    add('NO_CONFLICTS', () => 'Sources agree on the details', weights.noConflicts);
  }
  if (row.firstSeenAt >= context.now - thresholds.recentlyAddedDays * DAY_MS) {
    add('RECENTLY_ADDED', () => addedText(row.firstSeenAt, context), weights.recentlyAdded);
  }
}

const sum = (reasons: readonly RelevanceReason[]): number =>
  round3(reasons.reduce((total, reason) => total + reason.weightApplied, 0));

/** The score alone — what RELEVANCE computes for every matching row before paging. */
export function scoreOf(row: RankRow, context: RankContext): number {
  let total = 0;
  boosts(row, context, (_code, _text, weight) => {
    total += round3(weight);
  });
  return round3(total);
}

/** Score and reasons — what a row on the page carries. */
export function rank(row: RankRow, context: RankContext): Ranked {
  const reasons: RelevanceReason[] = [];
  boosts(row, context, (code, text, weight) => {
    reasons.push({ code, text: text(), weightApplied: round3(weight) });
  });
  const score = sum(reasons);
  const keyText = sortKeyText(row, context);
  const needsKey = context.sort !== 'RELEVANCE' || reasons.length === 0;
  if (needsKey && !reasons.some((reason) => reason.text === keyText)) {
    reasons.unshift({ code: 'SORT_KEY', text: keyText, weightApplied: 0 });
  }
  return { score, reasons };
}

/** RELEVANCE's order: score desc, then registration deadline asc (unknown last), then id. */
export interface RelevanceKey {
  readonly score: number;
  readonly deadline: number | null;
  readonly id: string;
}

export function compareRelevance(a: RelevanceKey, b: RelevanceKey): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.deadline !== b.deadline) {
    if (a.deadline === null) return 1;
    if (b.deadline === null) return -1;
    return a.deadline - b.deadline;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

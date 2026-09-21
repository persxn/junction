import type {
  EventMode,
  EventQuery,
  EventType,
  Money,
  OrganizerKind,
  RegState,
  SearchSort,
} from '@compintel/contracts';

import type { Point } from '../../../domain/geo/distance.js';
import { endOfDayIn, zonedDayBounds } from '../../../platform/time.js';
import { radiusRanges, type RadiusRanges } from './distance.js';
import { trigramMatchExpression } from './trigram.js';
import { wordTokens } from './text.js';

/**
 * `EventQuery` → `QueryPlan`: every interpretation §8.1 and rulings A6/A7 make,
 * decided once, in pure code, before any SQL exists.
 *
 * The plan is what the repository executes and what a reviewer reads — it is
 * golden-tested, so a change in what a query *means* shows up as a diff. The
 * SQL is then a transcription: it never decides anything the plan did not say.
 *
 * - **Dates (A7).** `YYYY-MM-DD` is a day in Asia/Kolkata: `from` is its first
 *   millisecond, `to` its last, both inclusive, as UTC ms.
 * - **Unknown values (A6).** An active filter excludes events whose value for
 *   that field is unknown, unless `includeUnknown.<field>` is true. `freeOnly`
 *   never matches an unknown fee.
 * - **Distance (A6, D-06).** Straight line from the primary campus, for every
 *   event that is not ONLINE; ONLINE events are dropped unless `modes` names
 *   ONLINE, and then they stay, with no distance.
 */

/** §6.4: the deadline is seven days away or less. */
export const CLOSING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export type SortBasis = 'TEXT_SCORE' | 'DEADLINE' | 'START' | 'DISTANCE' | 'PRIZE' | 'NEWEST';

export interface PlanSort {
  /** What the caller asked for (RELEVANCE when they did not say). */
  readonly requested: SearchSort;
  /** What the rows are ordered by. RELEVANCE with no text has no score to use. */
  readonly basis: SortBasis;
  readonly direction: 'ASC' | 'DESC';
}

export interface QueryPlan {
  readonly now: number;
  readonly text?: {
    readonly raw: string;
    readonly words: readonly string[];
    /** `null` when no fragment can be looked up by substring. */
    readonly trigram: string | null;
  };
  readonly eventTypes?: readonly EventType[];
  readonly modes?: readonly EventMode[];
  readonly organizerKinds?: readonly OrganizerKind[];
  readonly institutionIds?: readonly string[];
  readonly categories?: readonly string[];
  readonly tags?: readonly string[];
  readonly includeRecurring: boolean;
  readonly includeEnded: boolean;
  readonly fee?: {
    readonly freeOnly: boolean;
    readonly max?: Money;
    readonly includeUnknown: boolean;
  };
  readonly prizeMin?: Money;
  readonly teamSize?: { readonly fits: number; readonly includeUnknown: boolean };
  readonly distance?: {
    readonly maxKm: number;
    readonly center: Point;
    readonly ranges: RadiusRanges;
    /** A6: ONLINE rows pass (undistanced) only when `modes` names ONLINE. */
    readonly includeOnline: boolean;
    readonly includeUnknown: boolean;
  };
  readonly registration?: {
    readonly fromMs?: number;
    readonly toMs?: number;
    readonly states?: readonly RegState[];
    readonly includeUnknown: boolean;
    readonly closingSoonUntil: number;
  };
  readonly eventDate?: { readonly fromMs?: number; readonly toMs?: number };
  readonly excludeHidden: boolean;
  readonly watchlistedOnly: boolean;
  /** The campus distances are measured from, when one is configured. */
  readonly campus?: Point;
  readonly sort: PlanSort;
  readonly limit: number;
}

export interface PlanContext {
  readonly nowMs: number;
  /** The display zone dates are read in (A7): `Asia/Kolkata`. */
  readonly timeZone: string;
  readonly campus?: Point | undefined;
}

export type PlanErrorCode = 'NO_CAMPUS';

/** A query that is valid in shape but cannot be answered on this installation. */
export class QueryPlanError extends Error {
  readonly code: PlanErrorCode;
  constructor(code: PlanErrorCode, message: string) {
    super(message);
    this.name = 'QueryPlanError';
    this.code = code;
  }
}

/** A7: the first millisecond of `day` in the display zone, as UTC ms. */
function dayStart(timeZone: string, day: string): number {
  return zonedDayBounds(timeZone, day).startUtc.getTime();
}

/** A7: the last millisecond of `day` in the display zone — inclusive. */
function dayEnd(timeZone: string, day: string): number {
  return endOfDayIn(timeZone, day).getTime();
}

const SORT_DIRECTION: Readonly<Record<SortBasis, 'ASC' | 'DESC'>> = {
  TEXT_SCORE: 'ASC', // bm25 is negative; lower is better
  DEADLINE: 'ASC',
  START: 'ASC',
  DISTANCE: 'ASC',
  PRIZE: 'DESC',
  NEWEST: 'DESC',
};

function planSort(requested: SearchSort, hasText: boolean): PlanSort {
  const basis: SortBasis =
    requested === 'RELEVANCE' ? (hasText ? 'TEXT_SCORE' : 'DEADLINE') : requested;
  return { requested, basis, direction: SORT_DIRECTION[basis] };
}

/** A de-duplicated list filter, or `undefined` — an empty list never reaches SQL. */
function distinct<T>(values: readonly T[] | undefined): readonly T[] | undefined {
  return values === undefined || values.length === 0 ? undefined : [...new Set(values)];
}

export function planQuery(query: EventQuery, context: PlanContext): QueryPlan {
  const unknown = query.includeUnknown ?? {};
  const text = query.text?.trim();
  const hasText = text !== undefined && text.length > 0;
  const requestedSort = query.sort ?? 'RELEVANCE';

  const needsCampus = query.maxDistanceKm !== undefined || requestedSort === 'DISTANCE';
  if (needsCampus && context.campus === undefined) {
    throw new QueryPlanError(
      'NO_CAMPUS',
      'No primary campus with coordinates is configured, so distances cannot be measured.',
    );
  }

  const registration = query.registration;
  const registrationActive =
    registration !== undefined &&
    (registration.deadlineFrom !== undefined ||
      registration.deadlineTo !== undefined ||
      (registration.states?.length ?? 0) > 0);

  const feeActive = query.freeOnly === true || query.feeMax !== undefined;
  const eventDateActive =
    query.eventDate !== undefined &&
    (query.eventDate.from !== undefined || query.eventDate.to !== undefined);

  const eventTypes = distinct(query.eventTypes);
  const modes = distinct(query.modes);
  const organizerKinds = distinct(query.organizerKinds);
  const institutionIds = distinct(query.institutionIds);
  const categories = distinct(query.categories);
  const tags = distinct(query.tags);
  const states = distinct(registration?.states);

  return {
    now: context.nowMs,
    ...(hasText
      ? {
          text: {
            raw: text,
            words: wordTokens(text),
            trigram: trigramMatchExpression(text) ?? null,
          },
        }
      : {}),
    ...(eventTypes === undefined ? {} : { eventTypes }),
    ...(modes === undefined ? {} : { modes }),
    ...(organizerKinds === undefined ? {} : { organizerKinds }),
    ...(institutionIds === undefined ? {} : { institutionIds }),
    ...(categories === undefined ? {} : { categories }),
    ...(tags === undefined ? {} : { tags }),
    includeRecurring: query.includeRecurring === true,
    includeEnded: query.includeEnded === true,
    ...(feeActive
      ? {
          fee: {
            freeOnly: query.freeOnly === true,
            ...(query.feeMax === undefined ? {} : { max: query.feeMax }),
            // A6: `freeOnly` never matches an unknown fee, whatever the flag says.
            includeUnknown: query.freeOnly !== true && unknown.fee === true,
          },
        }
      : {}),
    ...(query.prizeMin === undefined ? {} : { prizeMin: query.prizeMin }),
    ...(query.teamSizeFits === undefined
      ? {}
      : { teamSize: { fits: query.teamSizeFits, includeUnknown: unknown.teamSize === true } }),
    ...(query.maxDistanceKm === undefined || context.campus === undefined
      ? {}
      : {
          distance: {
            maxKm: query.maxDistanceKm,
            center: context.campus,
            ranges: radiusRanges(context.campus, query.maxDistanceKm),
            includeOnline: query.modes?.includes('ONLINE') === true,
            includeUnknown: unknown.location === true,
          },
        }),
    ...(registrationActive
      ? {
          registration: {
            ...(registration.deadlineFrom === undefined
              ? {}
              : { fromMs: dayStart(context.timeZone, registration.deadlineFrom) }),
            ...(registration.deadlineTo === undefined
              ? {}
              : { toMs: dayEnd(context.timeZone, registration.deadlineTo) }),
            ...(states === undefined ? {} : { states }),
            includeUnknown: unknown.deadline === true,
            closingSoonUntil: context.nowMs + CLOSING_SOON_MS,
          },
        }
      : {}),
    ...(eventDateActive
      ? {
          eventDate: {
            ...(query.eventDate?.from === undefined
              ? {}
              : { fromMs: dayStart(context.timeZone, query.eventDate.from) }),
            ...(query.eventDate?.to === undefined
              ? {}
              : { toMs: dayEnd(context.timeZone, query.eventDate.to) }),
          },
        }
      : {}),
    excludeHidden: query.excludeHidden === true,
    watchlistedOnly: query.watchlistedOnly === true,
    ...(context.campus === undefined ? {} : { campus: context.campus }),
    sort: planSort(requestedSort, hasText),
    limit: query.limit,
  };
}

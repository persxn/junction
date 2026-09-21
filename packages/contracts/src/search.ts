import { z } from 'zod';

import { EventMode, EventType, RegState } from './enums.js';
import { CurrencyCode, DatePrecision, EventDetail, OrganizerKind } from './events.js';
import { Uuid7 } from './ids.js';

/**
 * The one query model (§8.1, ADR-0003/0006).
 *
 * `EventQuery` is consumed by the filter UI, saved searches, dashboard widgets
 * and — in M4 — the AI planner. That is why every object here is `.strict()`:
 * a key this schema does not know is a caller inventing a second query shape,
 * and that has to fail loudly at the boundary rather than be dropped and leave
 * a professor looking at results for a filter that was never applied.
 *
 * Interpretation — what a date means, what "unknown" means, how distance and
 * mode interact — is the backend's query planner (`modules/search/domain`),
 * not this file. Rulings A6/A7 are quoted where they shape a field.
 */

/** Longest free text a query may carry (§8.1); beyond it → `SEARCH_TEXT_TOO_LONG`. */
export const SEARCH_TEXT_MAX = 200;
export const SEARCH_LIMIT_DEFAULT = 25;
export const SEARCH_LIMIT_MAX = 100;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDay(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * `YYYY-MM-DD`, a real calendar day. Ruling A7: it is read in Asia/Kolkata —
 * `from` is 00:00:00.000 of that day, `to` the end of it, both inclusive — and
 * converted to UTC milliseconds by the query builder, never by the caller.
 */
export const IsoDate = z
  .string()
  .regex(ISO_DATE_PATTERN, 'Expected a YYYY-MM-DD date')
  .refine(isRealDay, 'Not a real calendar day');
export type IsoDate = z.infer<typeof IsoDate>;

/** An amount in minor units (§6.1). Currencies are never converted (R63). */
export const Money = z
  .object({
    minor: z.int().min(0),
    currency: CurrencyCode,
  })
  .strict();
export type Money = z.infer<typeof Money>;

export const SEARCH_SORTS = [
  'RELEVANCE',
  'DEADLINE',
  'START',
  'DISTANCE',
  'PRIZE',
  'NEWEST',
] as const;
export const SearchSort = z.enum(SEARCH_SORTS);
export type SearchSort = z.infer<typeof SearchSort>;

/** A filter-value list: at least one value, no silly lengths. */
const valueList = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(50);

/** A category slug or tag name as the UI sends it. */
const Label = z.string().trim().min(1).max(100);

function ordered(from: string | undefined, to: string | undefined): boolean {
  return from === undefined || to === undefined || from <= to;
}

export const RegistrationFilter = z
  .object({
    states: valueList(RegState).optional(),
    deadlineFrom: IsoDate.optional(),
    deadlineTo: IsoDate.optional(),
  })
  .strict()
  .refine((value) => ordered(value.deadlineFrom, value.deadlineTo), {
    message: 'deadlineFrom must not be after deadlineTo',
    path: ['deadlineTo'],
  });
export type RegistrationFilter = z.infer<typeof RegistrationFilter>;

export const DateRange = z
  .object({
    from: IsoDate.optional(),
    to: IsoDate.optional(),
  })
  .strict()
  .refine((value) => ordered(value.from, value.to), {
    message: 'from must not be after to',
    path: ['to'],
  });
export type DateRange = z.infer<typeof DateRange>;

/**
 * Ruling A6: with a filter on one of these fields active, an event whose value
 * is unknown is **excluded** unless its flag here is true. `freeOnly` never
 * matches an unknown fee, whatever `fee` says.
 */
export const IncludeUnknown = z
  .object({
    fee: z.boolean().optional(),
    teamSize: z.boolean().optional(),
    location: z.boolean().optional(),
    deadline: z.boolean().optional(),
  })
  .strict();
export type IncludeUnknown = z.infer<typeof IncludeUnknown>;

export const EventQuery = z
  .object({
    text: z.string().max(SEARCH_TEXT_MAX).optional(),
    eventTypes: valueList(EventType).optional(),
    categories: valueList(Label).optional(),
    tags: valueList(Label).optional(),
    modes: valueList(EventMode).optional(),
    /**
     * Straight line from the primary campus (D-06). Applies to OFFLINE and
     * HYBRID events; ONLINE ones are excluded unless `modes` names ONLINE (A6).
     * Capped at half the Earth's circumference, beyond which it means nothing.
     */
    maxDistanceKm: z.number().positive().max(20_038).optional(),
    registration: RegistrationFilter.optional(),
    eventDate: DateRange.optional(),
    organizerKinds: valueList(OrganizerKind).optional(),
    institutionIds: valueList(Uuid7).optional(),
    freeOnly: z.boolean().optional(),
    feeMax: Money.optional(),
    prizeMin: Money.optional(),
    /** `team_min ≤ n ≤ team_max`. */
    teamSizeFits: z.int().min(1).max(1000).optional(),
    includeUnknown: IncludeUnknown.optional(),
    includeRecurring: z.boolean().optional(),
    includeEnded: z.boolean().optional(),
    watchlistedOnly: z.boolean().optional(),
    excludeHidden: z.boolean().optional(),
    sort: SearchSort.optional(),
    /** Opaque; only a `nextCursor` this backend issued for the same query is accepted. */
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT_DEFAULT),
  })
  .strict();
/** What a caller sends (`limit` may be left out). */
export type EventQueryInput = z.input<typeof EventQuery>;
/** What the planner receives (`limit` filled in). */
export type EventQuery = z.infer<typeof EventQuery>;

/** Prize as the card shows it: the stated text and, when parsed, the amount. */
export const PrizeSummary = z
  .object({
    text: z.string().nullable(),
    totalMinor: z.int().min(0).nullable(),
    currency: CurrencyCode.nullable(),
  })
  .strict();
export type PrizeSummary = z.infer<typeof PrizeSummary>;

/**
 * One dense card (§16.2): title, organizer, type, mode/distance, countdown,
 * prize, team size, source icons, conflict marker. Dates carry their precision
 * because a date-only deadline is shown as such (ADR-0015).
 */
export const EventListItem = z
  .object({
    id: Uuid7,
    title: z.string().min(1),
    organizerName: z.string().nullable(),
    eventType: EventType,
    mode: EventMode,
    /** Straight-line km from the primary campus; null when unknown or online. */
    distanceKm: z.number().min(0).nullable(),
    registrationDeadlineAt: z.int().nullable(),
    registrationDeadlinePrecision: DatePrecision,
    startsAt: z.int().nullable(),
    datePrecision: DatePrecision,
    prize: PrizeSummary,
    teamMin: z.int().nullable(),
    teamMax: z.int().nullable(),
    /** Keys of the sources that list it (`ctftime`, `devfolio`, `manual`, …). */
    sources: z.array(z.string().min(1)),
    hasConflicts: z.boolean(),
  })
  .strict();
export type EventListItem = z.infer<typeof EventListItem>;

/**
 * A typo correction (F5/A5) — always reported, never silent. `message` is the
 * sentence the UI shows: "Showing results for hackathon (searched hackthon)".
 */
export const SpellingCorrection = z
  .object({
    searchedTerm: z.string().min(1),
    usedTerm: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type SpellingCorrection = z.infer<typeof SpellingCorrection>;

// ---- Ranking and relevance reasons (§8.4, D-18, WP-15b) ------------------------

/**
 * Why a result is where it is. The list is closed: the UI maps each code to an
 * icon, and a code it does not know would be a reason it cannot show.
 *
 * `SORT_KEY` is the one addition to the ten the WP-15b prompt lists: the value
 * a non-RELEVANCE sort ordered by ("Starts 3 Oct", "Prize ₹50,000") and, for
 * RELEVANCE with no text and no boost, the deadline tie-break. Without it an
 * event sorted by start date that fires no boost would have nothing to say.
 */
export const RELEVANCE_REASON_CODES = [
  'TEXT_MATCH',
  'REGISTRATION_OPEN',
  'CLOSING_SOON',
  'WITHIN_RADIUS',
  'CATEGORY_MATCH',
  'TAG_MATCH',
  'TEAM_SIZE_FITS',
  'TRUSTED_SOURCE',
  'NO_CONFLICTS',
  'RECENTLY_ADDED',
  'SORT_KEY',
] as const;
export const RelevanceReasonCode = z.enum(RELEVANCE_REASON_CODES);
export type RelevanceReasonCode = z.infer<typeof RelevanceReasonCode>;

/** One "Why relevant?" line: the sentence, and what it added to the score. */
export const RelevanceReason = z
  .object({
    code: RelevanceReasonCode,
    /** The rendered sentence: "~120 km (straight line)", "Registration open until 27 Sep". */
    text: z.string().min(1),
    /** Points this reason added; 0 for a reason that explains the order without scoring. */
    weightApplied: z.number().min(0),
  })
  .strict();
export type RelevanceReason = z.infer<typeof RelevanceReason>;

/**
 * A card plus its score and reasons. `reasons` has at least one entry — D-18's
 * acceptance criterion is a schema rule here, so an empty list cannot be
 * serialized by the route, whatever the scorer does.
 */
export const RankedEventListItem = EventListItem.extend({
  /** Whether the calling professor has saved it (§6.2 `watchlist_items`). */
  watchlisted: z.boolean(),
  score: z.number().min(0),
  reasons: z.array(RelevanceReason).min(1),
}).strict();
export type RankedEventListItem = z.infer<typeof RankedEventListItem>;

/** One facet value: what to send back as the filter, what to show, how many. */
export const FacetValue = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1),
    count: z.int().min(0),
  })
  .strict();
export type FacetValue = z.infer<typeof FacetValue>;

/** The distance buckets (D-06): four radii and "Anywhere". */
export const DISTANCE_BUCKET_VALUES = ['50', '100', '250', '500', 'ANYWHERE'] as const;

/** Value `OTHER` in a capped family: every row that holds a value outside the top 20. */
export const FACET_OTHER_VALUE = 'OTHER';
export const FACET_VALUES_MAX = 20;

/**
 * Facet counts (§8.2). Counting rule: a value's count is the number of results
 * the query would return if **that family's filter were exactly that value**
 * and every other filter stayed as sent. Visibility, `excludeHidden` and
 * `watchlistedOnly` apply before anything is counted. Distance buckets are
 * therefore cumulative ("Within 100 km" includes "Within 50 km").
 */
export const Facets = z
  .object({
    eventType: z.array(FacetValue),
    category: z.array(FacetValue),
    mode: z.array(FacetValue),
    registrationState: z.array(FacetValue),
    distanceBucket: z.array(FacetValue),
  })
  .strict();
export type Facets = z.infer<typeof Facets>;

/**
 * The search body: an `EventQuery` plus `facets`, which is how a cheap caller
 * (the next page, a dashboard count) skips them. It is not part of the query —
 * a saved search stores the `EventQuery` alone.
 */
export const SearchRequest = EventQuery.extend({
  facets: z.boolean().optional(),
}).strict();
export type SearchRequestInput = z.input<typeof SearchRequest>;

export const SearchResponse = z
  .object({
    items: z.array(RankedEventListItem),
    facets: Facets.optional(),
    nextCursor: z.string().min(1).optional(),
    /** Every event matching the query, across all pages. */
    total: z.int().min(0),
    /** False while `total` is an exact count, which it is in WP-15a. */
    totalIsApproximate: z.boolean(),
    correction: SpellingCorrection.optional(),
  })
  .strict();
export type SearchResponse = z.infer<typeof SearchResponse>;

// ---- Aliases (§6.2 `search_aliases`) -----------------------------------------

/** An alias term or expansion: case-folded, single-spaced, 1–60 characters. */
export const AliasTerm = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .transform((value) => value.toLowerCase().replace(/\s+/g, ' '));

export const SearchAlias = z
  .object({
    term: z.string().min(1),
    expansions: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type SearchAlias = z.infer<typeof SearchAlias>;

export const SearchAliasList = z.object({ items: z.array(SearchAlias) }).strict();
export type SearchAliasList = z.infer<typeof SearchAliasList>;

/**
 * `PUT /admin/search-aliases/:term`. An existing term is refused with
 * `SEARCH_ALIAS_EXISTS` unless `replace` says the overwrite is intended.
 */
export const SearchAliasInput = z
  .object({
    expansions: z.array(AliasTerm).min(1).max(20),
    replace: z.boolean().optional(),
  })
  .strict();
export type SearchAliasInput = z.infer<typeof SearchAliasInput>;

// ---- Event detail (`GET /events/:id`) ------------------------------------------

/** A source that lists the event. */
export const EventSourceRef = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    url: z.string().min(1),
    firstSeenAt: z.int(),
    lastSeenAt: z.int(),
  })
  .strict();
export type EventSourceRef = z.infer<typeof EventSourceRef>;

/** A category the event carries (not suppressed, category active). */
export const EventCategoryRef = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
  })
  .strict();
export type EventCategoryRef = z.infer<typeof EventCategoryRef>;

/**
 * The core event. WP-16b extends it with claims, conflicts, the deadlines
 * timeline and change history; nothing here pre-empts those.
 */
export const EventCore = EventDetail.extend({
  distanceKm: z.number().min(0).nullable(),
  categories: z.array(EventCategoryRef),
  sources: z.array(EventSourceRef),
}).strict();
export type EventCore = z.infer<typeof EventCore>;

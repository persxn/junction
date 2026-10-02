import type { DatePrecision, EventMode, EventType } from '@compintel/contracts';

import type { CursorPosition } from './cursor.js';
import type { QueryPlan, SortBasis } from './domain/normalize.js';
import {
  allFilters,
  and,
  clause,
  DISTANCE_PRECISIONS,
  filterParts,
  placeholders,
  textCte,
  type Clause,
  type TextMatch,
} from './sql.js';

/**
 * The row shapes search reads and the SQL fragments that produce them. Kept
 * apart from `repo.ts` (the statements) so each stays readable.
 */

/** §8.2's bm25 weights, in `event_fts` column order: title, organizer, tags, description. */
export const BM25_WEIGHTS = [10, 4, 3, 1] as const;

/** A card as the page reads it. */
export interface SearchRow {
  readonly id: string;
  readonly title: string;
  readonly organizer_name: string | null;
  readonly event_type: EventType;
  readonly mode: EventMode;
  readonly distance_km: number | null;
  readonly registration_opens_at: number | null;
  readonly registration_deadline_at: number | null;
  readonly registration_deadline_precision: DatePrecision;
  readonly starts_at: number | null;
  readonly date_precision: DatePrecision;
  readonly prize_text: string | null;
  readonly prize_total_minor: number | null;
  readonly prize_currency: string | null;
  readonly team_min: number | null;
  readonly team_max: number | null;
  readonly has_conflicts: number;
  readonly first_seen_at: number;
  readonly text_score: number | null;
  /** The most trusted source listing the event (ranking's TRUSTED_SOURCE). */
  readonly top_source_id: string | null;
  /** Comma-joined ids of the event's categories / tags the user is interested in. */
  readonly interest_category_ids: string | null;
  readonly interest_tag_ids: string | null;
  /** Keyset columns: `nr`/`sk` for a structured sort; `sk` (milli-points), `tie`, `best` for RELEVANCE. */
  readonly nr?: 0 | 1;
  readonly sk?: number | null;
  readonly tie?: number;
  readonly best?: number | null;
  readonly total?: number;
}

/** The professor's interests, resolved to ids (§6.2 `user_interest_tags`). */
export interface InterestIds {
  readonly categoryIds: readonly string[];
  readonly tagIds: readonly string[];
}

export interface SearchExecution {
  readonly plan: QueryPlan;
  readonly text?: TextMatch;
  readonly userId: string;
  readonly after?: CursorPosition | undefined;
  readonly interests?: InterestIds;
  /** `trustedSourceMinRank`: TRUSTED_SOURCE fires at or above it (R88). */
  readonly trustedMinRank?: number;
}

/** The structured sorts' keys over `e`; DISTANCE sorts by the computed `distance_km`. */
export const SORT_KEY: Readonly<Record<Exclude<SortBasis, 'SCORE' | 'DISTANCE'>, string>> = {
  DEADLINE: 'e.registration_deadline_at',
  START: 'e.starts_at',
  PRIZE: 'e.prize_total_minor',
  NEWEST: 'e.first_seen_at',
};

export const CARD_COLUMNS = `e.id, e.title, e.organizer_name, e.event_type, e.mode, e.registration_opens_at,
  e.registration_deadline_at, e.registration_deadline_precision, e.starts_at, e.date_precision,
  e.prize_text, e.prize_total_minor, e.prize_currency, e.team_min, e.team_max, e.has_conflicts,
  e.first_seen_at`;

/** `NULL`, or a comma list of the ids in `ids` that the event holds. */
function interestColumn(ids: readonly string[] | undefined, sql: string): Clause {
  return ids === undefined || ids.length === 0
    ? clause('NULL')
    : clause(sql.replace('{ids}', placeholders(ids)), ...ids);
}

/** The per-event lookups as correlated columns over `e` — for a page of cards only. */
export function rankerColumns(execution: SearchExecution): Clause {
  const categoriesOf = interestColumn(
    execution.interests?.categoryIds,
    `(SELECT group_concat(ec.category_id) FROM event_categories ec WHERE ec.event_id = e.id AND ec.is_suppressed = 0 AND ec.category_id IN ({ids}))`,
  );
  const tagsOf = interestColumn(
    execution.interests?.tagIds,
    `(SELECT group_concat(et.tag_id) FROM event_tags et WHERE et.event_id = e.id AND et.tag_id IN ({ids}))`,
  );
  return clause(
    `(SELECT sr.source_id FROM source_records sr JOIN sources s ON s.id = sr.source_id
        WHERE sr.event_id = e.id ORDER BY s.trust_rank DESC, s.key LIMIT 1) AS top_source_id,
      ${categoriesOf.sql} AS interest_category_ids, ${tagsOf.sql} AS interest_tag_ids`,
    ...categoriesOf.params,
    ...tagsOf.params,
  );
}

/**
 * Whether a trusted source lists the event (R88): one column the resolver keeps,
 * where WP-15b had a lookup over `source_records` for every matching row.
 */
export function trustedColumn(execution: SearchExecution): Clause {
  return execution.trustedMinRank === undefined
    ? clause('0')
    : clause('(e.top_trust_rank >= ?)', execution.trustedMinRank);
}

export function distanceColumn(plan: QueryPlan): Clause {
  return plan.campus === undefined
    ? clause('NULL')
    : clause(
        `CASE WHEN e.mode <> 'ONLINE' AND e.geo_precision IN ${DISTANCE_PRECISIONS} THEN haversine_km(?, ?, e.lat, e.lon) END`,
        plan.campus.lat,
        plan.campus.lon,
      );
}

/**
 * `WITH … matched AS (SELECT distance_km, text_score, <columns> …)`: every row
 * the query matches. `undefined` when the text resolved to nothing to match.
 */
export function matchedCte(execution: SearchExecution, columns: Clause): Clause | undefined {
  const { plan } = execution;
  const cte = execution.text === undefined ? undefined : textCte(execution.text, BM25_WEIGHTS);
  if (execution.text !== undefined && cte === undefined) return undefined;
  const distance = distanceColumn(plan);
  const where = and(allFilters(filterParts(plan, execution.userId)));
  // CROSS JOIN fixes the loop order — walk the hits, look events up by rowid;
  // left alone, the planner scanned every event and probed the hits.
  const source =
    cte === undefined ? 'FROM events e' : 'FROM text_hits t CROSS JOIN events e ON e.rowid = t.rid';
  return clause(
    `WITH ${cte === undefined ? '' : `${cte.sql},`}
      matched AS (
        SELECT ${distance.sql} AS distance_km, ${cte === undefined ? 'NULL' : 't.score'} AS text_score, ${columns.sql}
        ${source}
        WHERE ${where.sql}
      )`,
    ...(cte?.params ?? []),
    ...distance.params,
    ...columns.params,
    ...where.params,
  );
}

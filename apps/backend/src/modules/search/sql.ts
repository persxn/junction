import type { QueryPlan } from './domain/normalize.js';

/**
 * The WHERE clauses a plan becomes (§8.2), shared by the result query
 * (`repo.ts`) and the facet query (`facets.ts`). Each facet family's own filter
 * is kept apart from the rest, because a facet counts with its own filter
 * removed and every other one applied (WP-15b step 6). Values are always bound.
 */

/** Only a coordinate at least this precise is a place a distance can be measured from. */
export const DISTANCE_PRECISIONS = `('EXACT', 'INSTITUTION', 'CITY')`;

export const VISIBLE = `e.visibility = 'VISIBLE' AND e.merged_into_event_id IS NULL`;

/** Whether the row has a place to measure from; `e.mode` must not be ONLINE either. */
export const LOCATED = `e.mode <> 'ONLINE' AND e.geo_precision IN ${DISTANCE_PRECISIONS} AND e.lat IS NOT NULL AND e.lon IS NOT NULL`;

/** §6.4's derived registration state, in SQL. `?` = now, now, closingSoonUntil. */
export const REG_STATE = `CASE
  WHEN e.registration_opens_at IS NOT NULL AND e.registration_opens_at > ? THEN 'NOT_OPEN'
  WHEN e.registration_deadline_at IS NULL THEN 'UNKNOWN'
  WHEN e.registration_deadline_at < ? THEN 'CLOSED'
  WHEN e.registration_deadline_at <= ? THEN 'CLOSING_SOON'
  ELSE 'OPEN' END`;

/** A WHERE fragment and its parameters, in the order its `?` appear. */
export interface Clause {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export const clause = (sql: string, ...params: unknown[]): Clause => ({ sql, params });
export const placeholders = (values: readonly unknown[]): string =>
  values.map(() => '?').join(', ');
export const and = (clauses: readonly Clause[]): Clause =>
  clauses.length === 0
    ? clause('1')
    : clause(clauses.map((c) => `(${c.sql})`).join(' AND '), ...clauses.flatMap((c) => c.params));

export interface TextMatch {
  /** `event_fts` MATCH expression; absent when the text held no word. */
  readonly fts?: string | undefined;
  /** `event_fts_trigram` MATCH expression; absent when no fragment is long enough. */
  readonly trigram?: string | undefined;
}

/** The plan's filters, split by facet family. */
export interface FilterParts {
  /** Visibility, per-user state and every filter no facet family owns. */
  readonly base: readonly Clause[];
  readonly eventTypes?: Clause;
  readonly modes?: Clause;
  readonly categories?: Clause;
  readonly registration?: Clause;
  /**
   * The registration filter's date range alone, without its `states` and
   * without the unknown-deadline escape — what the registration-state family
   * counts with (`facets.ts` adds the unknowns back exactly).
   */
  readonly registrationRange?: Clause;
  readonly distance?: Clause;
  /** The distance filter as if `modes` named ONLINE — what the mode family counts with. */
  readonly distanceWithOnline?: Clause;
}

/** Every filter, ANDed — the result query's WHERE. */
export function allFilters(parts: FilterParts): Clause[] {
  return [
    ...parts.base,
    ...[parts.eventTypes, parts.modes, parts.categories, parts.registration, parts.distance].filter(
      (part): part is Clause => part !== undefined,
    ),
  ];
}

const inList = (column: string, values: readonly unknown[] | undefined): Clause | undefined =>
  values === undefined ? undefined : clause(`${column} IN (${placeholders(values)})`, ...values);

function distanceClause(d: NonNullable<QueryPlan['distance']>, includeOnline: boolean): Clause {
  const lon = d.ranges.lon.map(() => 'e.lon BETWEEN ? AND ?').join(' OR ');
  const parts = [
    `(${LOCATED} AND e.lat BETWEEN ? AND ? AND (${lon}) AND haversine_km(?, ?, e.lat, e.lon) <= ?)`,
  ];
  if (includeOnline) parts.push(`e.mode = 'ONLINE'`);
  if (d.includeUnknown) parts.push(`(e.mode <> 'ONLINE' AND NOT (${LOCATED}))`);
  return clause(
    parts.join(' OR '),
    d.ranges.minLat,
    d.ranges.maxLat,
    ...d.ranges.lon.flatMap((range) => [range.min, range.max]),
    d.center.lat,
    d.center.lon,
    d.maxKm,
  );
}

function registrationClauses(plan: QueryPlan): { full: Clause; range: Clause } | undefined {
  const r = plan.registration;
  if (r === undefined) return undefined;
  const range: Clause[] = [];
  if (r.fromMs !== undefined) range.push(clause('e.registration_deadline_at >= ?', r.fromMs));
  if (r.toMs !== undefined) range.push(clause('e.registration_deadline_at <= ?', r.toMs));
  const states =
    r.states === undefined
      ? []
      : [
          clause(
            `(${REG_STATE}) IN (${placeholders(r.states)})`,
            plan.now,
            plan.now,
            r.closingSoonUntil,
            ...r.states,
          ),
        ];
  const unknown = r.includeUnknown ? ' OR e.registration_deadline_at IS NULL' : '';
  const build = (known: Clause[]): Clause => {
    const sql = known.length === 0 ? '1' : known.map((c) => c.sql).join(' AND ');
    return clause(`(${sql})${unknown}`, ...known.flatMap((c) => c.params));
  };
  return { full: build([...range, ...states]), range: and(range) };
}

export function filterParts(plan: QueryPlan, userId: string): FilterParts {
  const base: Clause[] = [clause(VISIBLE)];
  const push = (part: Clause | undefined): void => {
    if (part !== undefined) base.push(part);
  };
  push(inList('e.organizer_kind', plan.organizerKinds));
  push(inList('e.host_institution_id', plan.institutionIds));
  if (!plan.includeRecurring) base.push(clause('e.is_recurring_round = 0'));
  if (!plan.includeEnded) {
    base.push(
      clause(
        'coalesce(e.ends_at, e.starts_at) IS NULL OR coalesce(e.ends_at, e.starts_at) >= ?',
        plan.now,
      ),
    );
  }
  if (plan.tags !== undefined) {
    const tags = plan.tags.map((tag) => tag.trim().toLowerCase());
    base.push(
      clause(
        `EXISTS (SELECT 1 FROM event_tags et JOIN tags t ON t.id = et.tag_id WHERE et.event_id = e.id AND t.normalized IN (${placeholders(tags)}))`,
        ...tags,
      ),
    );
  }
  if (plan.fee !== undefined) {
    const known: Clause[] = [];
    if (plan.fee.freeOnly) known.push(clause('e.fee_minor = 0'));
    if (plan.fee.max !== undefined) {
      // Free is free in any currency; otherwise only the same currency compares (R63).
      known.push(
        clause(
          '(e.fee_minor = 0 OR (e.fee_currency = ? AND e.fee_minor <= ?))',
          plan.fee.max.currency,
          plan.fee.max.minor,
        ),
      );
    }
    const knownSql = ['e.fee_known = 1', ...known.map((c) => c.sql)].join(' AND ');
    base.push(
      clause(
        `(${knownSql})${plan.fee.includeUnknown ? ' OR e.fee_known = 0' : ''}`,
        ...known.flatMap((c) => c.params),
      ),
    );
  }
  if (plan.prizeMin !== undefined) {
    base.push(
      clause(
        'e.prize_total_minor >= ? AND e.prize_currency = ?',
        plan.prizeMin.minor,
        plan.prizeMin.currency,
      ),
    );
  }
  if (plan.teamSize !== undefined) {
    const n = plan.teamSize.fits;
    // A missing bound is open-ended ("up to 4", "at least 2"); both missing is unknown (A6).
    const known =
      '(e.team_min IS NOT NULL OR e.team_max IS NOT NULL) AND coalesce(e.team_min, 1) <= ? AND coalesce(e.team_max, ?) >= ?';
    const unknown = plan.teamSize.includeUnknown
      ? ' OR (e.team_min IS NULL AND e.team_max IS NULL)'
      : '';
    base.push(clause(`(${known})${unknown}`, n, n, n));
  }
  if (plan.eventDate !== undefined) {
    // Overlap: the event runs on at least one day of the range. An unknown start never matches.
    const parts: Clause[] = [clause('e.starts_at IS NOT NULL')];
    if (plan.eventDate.fromMs !== undefined)
      parts.push(clause('coalesce(e.ends_at, e.starts_at) >= ?', plan.eventDate.fromMs));
    if (plan.eventDate.toMs !== undefined)
      parts.push(clause('e.starts_at <= ?', plan.eventDate.toMs));
    base.push(and(parts));
  }
  if (plan.excludeHidden) {
    base.push(
      clause(
        'NOT EXISTS (SELECT 1 FROM event_user_state s WHERE s.user_id = ? AND s.event_id = e.id AND s.is_hidden = 1)',
        userId,
      ),
    );
  }
  if (plan.watchlistedOnly) {
    base.push(
      clause(
        'EXISTS (SELECT 1 FROM watchlist_items w WHERE w.user_id = ? AND w.event_id = e.id)',
        userId,
      ),
    );
  }

  const registration = registrationClauses(plan);
  const categories =
    plan.categories === undefined
      ? undefined
      : clause(
          `EXISTS (SELECT 1 FROM event_categories ec JOIN categories c ON c.id = ec.category_id
             WHERE ec.event_id = e.id AND ec.is_suppressed = 0 AND c.is_active = 1 AND c.slug IN (${placeholders(plan.categories)}))`,
          ...plan.categories,
        );
  const eventTypes = inList('e.event_type', plan.eventTypes);
  const modes = inList('e.mode', plan.modes);
  return {
    base,
    ...(eventTypes === undefined ? {} : { eventTypes }),
    ...(modes === undefined ? {} : { modes }),
    ...(categories === undefined ? {} : { categories }),
    ...(registration === undefined
      ? {}
      : { registration: registration.full, registrationRange: registration.range }),
    ...(plan.distance === undefined
      ? {}
      : {
          distance: distanceClause(plan.distance, plan.distance.includeOnline),
          distanceWithOnline: distanceClause(plan.distance, true),
        }),
  };
}

export function textCte(text: TextMatch, bm25Weights: readonly number[]): Clause | undefined {
  const branches: Clause[] = [];
  if (text.fts !== undefined) {
    // MATERIALIZED: flattened into an outer aggregate, SQLite refuses bm25()
    // ("unable to use function bm25 in the requested context").
    branches.push(
      clause(
        `fts_hits AS MATERIALIZED (SELECT rowid AS rid, bm25(event_fts, ${bm25Weights.join(', ')}) AS score FROM event_fts WHERE event_fts MATCH ?)`,
        text.fts,
      ),
    );
  }
  if (text.trigram !== undefined) {
    // A substring-only hit ranks after every word hit: bm25 is always negative.
    branches.push(
      clause(
        'trigram_hits AS MATERIALIZED (SELECT rowid AS rid, 0.0 AS score FROM event_fts_trigram WHERE event_fts_trigram MATCH ?)',
        text.trigram,
      ),
    );
  }
  if (branches.length === 0) return undefined;
  const names = [
    ...(text.fts === undefined ? [] : ['fts_hits']),
    ...(text.trigram === undefined ? [] : ['trigram_hits']),
  ];
  const union = names.map((name) => `SELECT rid, score FROM ${name}`).join(' UNION ALL ');
  return clause(
    `${branches.map((b) => b.sql).join(', ')},
      text_hits(rid, score) AS (SELECT rid, min(score) FROM (${union}) GROUP BY rid)`,
    ...branches.flatMap((b) => b.params),
  );
}

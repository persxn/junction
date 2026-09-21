import type { DatePrecision, EventMode, EventSourceRef, EventType } from '@compintel/contracts';

import type { Point } from '../../domain/geo/distance.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { CursorPosition } from './cursor.js';
import type { QueryPlan, SortBasis } from './domain/normalize.js';

/**
 * Every raw SQL statement search runs (§8.2) — and the only file that has any.
 * The plan (`domain/normalize.ts`) decided what the query means; this file
 * transcribes it. Values, MATCH expressions included, are always bound. The SQL
 * is SQLite-specific on purpose: §4.5 exempts the search module.
 */

/** §8.2's bm25 weights, in `event_fts` column order: title, organizer, tags, description. */
export const BM25_WEIGHTS = [10, 4, 3, 1] as const;

/** Only a coordinate at least this precise is a place a distance can be measured from. */
const DISTANCE_PRECISIONS = `('EXACT', 'INSTITUTION', 'CITY')`;

const VISIBLE = `e.visibility = 'VISIBLE' AND e.merged_into_event_id IS NULL`;

/** §6.4's derived registration state, in SQL. `?` = now, now, closingSoonUntil. */
const REG_STATE = `CASE
  WHEN e.registration_opens_at IS NOT NULL AND e.registration_opens_at > ? THEN 'NOT_OPEN'
  WHEN e.registration_deadline_at IS NULL THEN 'UNKNOWN'
  WHEN e.registration_deadline_at < ? THEN 'CLOSED'
  WHEN e.registration_deadline_at <= ? THEN 'CLOSING_SOON'
  ELSE 'OPEN' END`;

const SORT_KEY: Readonly<Record<SortBasis, string>> = {
  TEXT_SCORE: 'm.text_score',
  DEADLINE: 'm.registration_deadline_at',
  START: 'm.starts_at',
  DISTANCE: 'm.distance_km',
  PRIZE: 'm.prize_total_minor',
  NEWEST: 'm.first_seen_at',
};

export interface TextMatch {
  /** `event_fts` MATCH expression; absent when the text held no word. */
  readonly fts?: string | undefined;
  /** `event_fts_trigram` MATCH expression; absent when no fragment is long enough. */
  readonly trigram?: string | undefined;
}

export interface SearchRow {
  readonly id: string;
  readonly title: string;
  readonly organizer_name: string | null;
  readonly event_type: EventType;
  readonly mode: EventMode;
  readonly distance_km: number | null;
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
  readonly nr: 0 | 1;
  readonly sk: number | null;
  readonly total: number;
}

export interface SearchExecution {
  readonly plan: QueryPlan;
  readonly text?: TextMatch;
  readonly userId: string;
  readonly after?: CursorPosition | undefined;
}

/** A WHERE fragment and its parameters, in the order its `?` appear. */
interface Clause {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const clause = (sql: string, ...params: unknown[]): Clause => ({ sql, params });
const placeholders = (values: readonly unknown[]): string => values.map(() => '?').join(', ');

function filterClauses(plan: QueryPlan, userId: string): Clause[] {
  const out: Clause[] = [clause(VISIBLE)];
  const inList = (column: string, values: readonly unknown[] | undefined): void => {
    if (values !== undefined) out.push(clause(`${column} IN (${placeholders(values)})`, ...values));
  };
  inList('e.event_type', plan.eventTypes);
  inList('e.mode', plan.modes);
  inList('e.organizer_kind', plan.organizerKinds);
  inList('e.host_institution_id', plan.institutionIds);
  if (!plan.includeRecurring) out.push(clause('e.is_recurring_round = 0'));
  if (!plan.includeEnded) {
    out.push(
      clause(
        '(coalesce(e.ends_at, e.starts_at) IS NULL OR coalesce(e.ends_at, e.starts_at) >= ?)',
        plan.now,
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
    out.push(
      clause(
        `((${knownSql})${plan.fee.includeUnknown ? ' OR e.fee_known = 0' : ''})`,
        ...known.flatMap((c) => c.params),
      ),
    );
  }
  if (plan.prizeMin !== undefined) {
    out.push(
      clause(
        '(e.prize_total_minor >= ? AND e.prize_currency = ?)',
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
    out.push(clause(`((${known})${unknown})`, n, n, n));
  }
  if (plan.distance !== undefined) {
    const d = plan.distance;
    const lon = d.ranges.lon.map(() => 'e.lon BETWEEN ? AND ?').join(' OR ');
    const located = `e.mode <> 'ONLINE' AND e.geo_precision IN ${DISTANCE_PRECISIONS} AND e.lat IS NOT NULL AND e.lon IS NOT NULL`;
    const parts = [
      `(${located} AND e.lat BETWEEN ? AND ? AND (${lon}) AND haversine_km(?, ?, e.lat, e.lon) <= ?)`,
    ];
    if (d.includeOnline) parts.push(`e.mode = 'ONLINE'`);
    if (d.includeUnknown) parts.push(`(e.mode <> 'ONLINE' AND NOT (${located}))`);
    out.push(
      clause(
        `(${parts.join(' OR ')})`,
        d.ranges.minLat,
        d.ranges.maxLat,
        ...d.ranges.lon.flatMap((range) => [range.min, range.max]),
        d.center.lat,
        d.center.lon,
        d.maxKm,
      ),
    );
  }
  if (plan.registration !== undefined) {
    const r = plan.registration;
    const known: Clause[] = [];
    if (r.fromMs !== undefined) known.push(clause('e.registration_deadline_at >= ?', r.fromMs));
    if (r.toMs !== undefined) known.push(clause('e.registration_deadline_at <= ?', r.toMs));
    if (r.states !== undefined) {
      known.push(
        clause(
          `(${REG_STATE}) IN (${placeholders(r.states)})`,
          plan.now,
          plan.now,
          r.closingSoonUntil,
          ...r.states,
        ),
      );
    }
    const knownSql = known.length === 0 ? '1' : known.map((c) => c.sql).join(' AND ');
    const unknown = r.includeUnknown ? ' OR e.registration_deadline_at IS NULL' : '';
    out.push(clause(`((${knownSql})${unknown})`, ...known.flatMap((c) => c.params)));
  }
  if (plan.eventDate !== undefined) {
    // Overlap: the event runs on at least one day of the range. An unknown start never matches.
    const parts: Clause[] = [clause('e.starts_at IS NOT NULL')];
    if (plan.eventDate.fromMs !== undefined)
      parts.push(clause('coalesce(e.ends_at, e.starts_at) >= ?', plan.eventDate.fromMs));
    if (plan.eventDate.toMs !== undefined)
      parts.push(clause('e.starts_at <= ?', plan.eventDate.toMs));
    out.push(clause(parts.map((c) => c.sql).join(' AND '), ...parts.flatMap((c) => c.params)));
  }
  if (plan.excludeHidden) {
    out.push(
      clause(
        'NOT EXISTS (SELECT 1 FROM event_user_state s WHERE s.user_id = ? AND s.event_id = e.id AND s.is_hidden = 1)',
        userId,
      ),
    );
  }
  if (plan.watchlistedOnly) {
    out.push(
      clause(
        'EXISTS (SELECT 1 FROM watchlist_items w WHERE w.user_id = ? AND w.event_id = e.id)',
        userId,
      ),
    );
  }
  return out;
}

function textCte(text: TextMatch): Clause | undefined {
  const branches: Clause[] = [];
  if (text.fts !== undefined) {
    // MATERIALIZED: flattened into an outer aggregate, SQLite refuses bm25()
    // ("unable to use function bm25 in the requested context").
    branches.push(
      clause(
        `fts_hits AS MATERIALIZED (SELECT rowid AS rid, bm25(event_fts, ${BM25_WEIGHTS.join(', ')}) AS score FROM event_fts WHERE event_fts MATCH ?)`,
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

function keysetClause(
  basis: SortBasis,
  direction: 'ASC' | 'DESC',
  after: CursorPosition | undefined,
): Clause | undefined {
  if (after === undefined) return undefined;
  if (after.sortKey === null) {
    return clause(
      '(m.nr > ? OR (m.nr = ? AND m.id > ?))',
      after.nullRank,
      after.nullRank,
      after.id,
    );
  }
  const op = direction === 'ASC' ? '>' : '<';
  const key = SORT_KEY[basis];
  return clause(
    `(m.nr > ? OR (m.nr = ? AND (${key} ${op} ? OR (${key} = ? AND m.id > ?))))`,
    after.nullRank,
    after.nullRank,
    after.sortKey,
    after.sortKey,
    after.id,
  );
}

export class SearchRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  /**
   * One page, plus the total: filters → optional text CTE → sort key → keyset →
   * `limit + 1` rows, so the caller knows whether another page exists without a
   * second query. `total` is a window count taken before the keyset, i.e. over
   * the whole result set.
   */
  search(execution: SearchExecution): SearchRow[] {
    const { plan } = execution;
    const cte = execution.text === undefined ? undefined : textCte(execution.text);
    if (execution.text !== undefined && cte === undefined) return [];

    const campus = plan.campus;
    const distance =
      campus === undefined
        ? clause('NULL')
        : clause(
            `CASE WHEN e.mode <> 'ONLINE' AND e.geo_precision IN ${DISTANCE_PRECISIONS} THEN haversine_km(?, ?, e.lat, e.lon) END`,
            campus.lat,
            campus.lon,
          );
    const filters = filterClauses(plan, execution.userId);
    const key = SORT_KEY[plan.sort.basis];
    const keyset = keysetClause(plan.sort.basis, plan.sort.direction, execution.after);

    // CROSS JOIN fixes the loop order — walk the hits, look events up by rowid;
    // left alone, the planner scanned every event and probed the hits.
    const source =
      cte === undefined
        ? 'FROM events e'
        : 'FROM text_hits t CROSS JOIN events e ON e.rowid = t.rid';
    const sql = `WITH ${cte === undefined ? '' : `${cte.sql},`}
      matched AS (
        SELECT e.id, e.title, e.organizer_name, e.event_type, e.mode,
          e.registration_deadline_at, e.registration_deadline_precision, e.starts_at, e.date_precision,
          e.prize_text, e.prize_total_minor, e.prize_currency, e.team_min, e.team_max, e.has_conflicts,
          e.first_seen_at, ${distance.sql} AS distance_km, ${cte === undefined ? 'NULL' : 't.score'} AS text_score
        ${source}
        WHERE ${filters.map((f) => f.sql).join(' AND ')}
      ),
      ranked AS (
        SELECT m.*, (${key} IS NULL) AS nr, ${key} AS sk, count(*) OVER () AS total FROM matched m
      )
      SELECT * FROM ranked m ${keyset === undefined ? '' : `WHERE ${keyset.sql}`}
      ORDER BY m.nr ASC, m.sk ${plan.sort.direction}, m.id ASC
      LIMIT ?`;
    const params = [
      ...(cte?.params ?? []),
      ...distance.params,
      ...filters.flatMap((f) => f.params),
      ...(keyset?.params ?? []),
      plan.limit + 1,
    ];
    return this.#db.raw.prepare(sql).all(...params) as SearchRow[];
  }

  /** Whether one word (or fragment) finds any visible event on its own — the typo gate (F5/A5). */
  hasVisibleHit(index: 'event_fts' | 'event_fts_trigram', match: string): boolean {
    const row = this.#db.raw
      .prepare(
        `SELECT 1 FROM ${index} f JOIN events e ON e.rowid = f.rowid WHERE ${index} MATCH ? AND ${VISIBLE} LIMIT 1`,
      )
      .get(match);
    return row !== undefined;
  }

  /** Source keys per event, for the cards' source icons. */
  sourceKeys(eventIds: readonly string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (eventIds.length === 0) return out;
    const rows = this.#db.raw
      .prepare(
        `SELECT DISTINCT sr.event_id AS eventId, s.key AS key FROM source_records sr JOIN sources s ON s.id = sr.source_id
         WHERE sr.event_id IN (${placeholders(eventIds)}) ORDER BY s.key`,
      )
      .all(...eventIds) as { eventId: string; key: string }[];
    for (const row of rows) out.set(row.eventId, [...(out.get(row.eventId) ?? []), row.key]);
    return out;
  }

  /** The sources that list one event, for its detail page. */
  sourcesOf(eventId: string): EventSourceRef[] {
    return this.#db.raw
      .prepare(
        `SELECT s.key AS key, s.name AS name, sr.url AS url, sr.first_seen_at AS firstSeenAt, sr.last_seen_at AS lastSeenAt
         FROM source_records sr JOIN sources s ON s.id = sr.source_id WHERE sr.event_id = ? ORDER BY s.trust_rank DESC, s.key`,
      )
      .all(eventId) as EventSourceRef[];
  }

  /** The primary campus, when the wizard has given it coordinates. */
  primaryCampus(): Point | undefined {
    const row = this.#db.raw
      .prepare(
        'SELECT lat, lon FROM campuses WHERE is_primary = 1 AND lat IS NOT NULL AND lon IS NOT NULL LIMIT 1',
      )
      .get() as { lat: number; lon: number } | undefined;
    return row === undefined ? undefined : { lat: row.lat, lon: row.lon };
  }

  /** Title and organizer of every visible event — what the vocabulary is built from. */
  vocabularySource(): { title: string; organizer: string | null }[] {
    return this.#db.raw
      .prepare(
        `SELECT e.title AS title, e.organizer_name AS organizer FROM events e WHERE ${VISIBLE}`,
      )
      .all() as { title: string; organizer: string | null }[];
  }

  /** Re-derives both FTS indexes from `events` — after a restore, or if a check ever fails. */
  rebuildIndexes(): void {
    this.#db.raw.transaction(() => {
      this.#db.raw.prepare(`INSERT INTO event_fts (event_fts) VALUES ('rebuild')`).run();
      this.#db.raw
        .prepare(`INSERT INTO event_fts_trigram (event_fts_trigram) VALUES ('rebuild')`)
        .run();
    })();
  }
}

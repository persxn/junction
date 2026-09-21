import type { EventCategoryRef, EventSourceRef } from '@compintel/contracts';

import type { Point } from '../../domain/geo/distance.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { CursorPosition } from './cursor.js';
import { BEST, scoreExpression, UNKNOWN_DEADLINE_KEY, type ScoreParams } from './score-sql.js';
import {
  CARD_COLUMNS,
  matchedCte,
  rankerColumns,
  SORT_KEY,
  trustedColumn,
  type SearchExecution,
  type SearchRow,
} from './rows.js';
import { clause, placeholders, VISIBLE, type Clause } from './sql.js';

/**
 * Every raw SQL statement search runs for results and detail (§8.2); WHERE
 * clauses live in `sql.ts`, row shapes and fragments in `rows.ts`, the facet
 * statement in `facets.ts`. The plan (`domain/normalize.ts`) decided what the
 * query means; this file transcribes it. Values, MATCH expressions included,
 * are always bound. The SQL is SQLite-specific on purpose: §4.5 exempts search.
 */

export { BM25_WEIGHTS, type InterestIds, type SearchExecution, type SearchRow } from './rows.js';
export type { TextMatch } from './sql.js';

/** Rows after the cursor, on the ranked CTE's (nr, sk, id). */
function keysetClause(
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
  return clause(
    `(m.nr > ? OR (m.nr = ? AND (m.sk ${op} ? OR (m.sk = ? AND m.id > ?))))`,
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
   * One page of a structured sort, plus the total: the sort runs over
   * (id, key) only, keyset → `limit + 1` rows, then the page's cards and the
   * ranker's lookups are read for those rows alone. `total` is a window count
   * over the whole result set.
   */
  search(execution: SearchExecution): SearchRow[] {
    const { plan } = execution;
    const basis = plan.sort.basis;
    if (basis === 'SCORE') throw new Error('RELEVANCE pages through relevance()');
    const matched = matchedCte(
      execution,
      clause(`e.id, ${basis === 'DISTANCE' ? 'NULL' : SORT_KEY[basis]} AS sk_raw`),
    );
    if (matched === undefined) return [];
    const key = basis === 'DISTANCE' ? 'm.distance_km' : 'm.sk_raw';
    const keyset = keysetClause(plan.sort.direction, execution.after);
    const ranker = rankerColumns(execution);
    const sql = `${matched.sql},
      ranked AS (
        SELECT m.id, m.distance_km, m.text_score, (${key} IS NULL) AS nr, ${key} AS sk,
          count(*) OVER () AS total FROM matched m
      ),
      page AS MATERIALIZED (
        SELECT * FROM ranked m ${keyset === undefined ? '' : `WHERE ${keyset.sql}`}
        ORDER BY m.nr ASC, m.sk ${plan.sort.direction}, m.id ASC LIMIT ?
      )
      SELECT ${CARD_COLUMNS}, p.distance_km, p.text_score, p.nr, p.sk, p.total, ${ranker.sql}
      FROM page p JOIN events e ON e.id = p.id
      ORDER BY p.nr ASC, p.sk ${plan.sort.direction}, p.id ASC`;
    return this.#db.raw
      .prepare(sql)
      .all(
        ...matched.params,
        ...(keyset?.params ?? []),
        plan.limit + 1,
        ...ranker.params,
      ) as SearchRow[];
  }

  /**
   * One page of RELEVANCE (§8.4): the score (`score-sql.ts`, mirroring
   * `rank.ts`) is computed in SQL over every match, ordered (score desc,
   * deadline asc with unknown last, id asc), keyset-paged, and only the page's
   * cards and lookups are read. `sk` is the score in milli-points, `tie` the
   * deadline key, `best` the set's best bm25 (for the page's reasons).
   */
  relevance(execution: SearchExecution, score: ScoreParams): SearchRow[] {
    const interest = (ids: readonly string[] | undefined, sql: string): Clause =>
      ids === undefined || ids.length === 0
        ? clause('0')
        : clause(sql.replace('{ids}', placeholders(ids)), ...ids);
    const trusted = trustedColumn(execution);
    const category = interest(
      execution.interests?.categoryIds,
      '(e.id IN (SELECT event_id FROM event_categories WHERE is_suppressed = 0 AND category_id IN ({ids})))',
    );
    const tag = interest(
      execution.interests?.tagIds,
      '(e.id IN (SELECT event_id FROM event_tags WHERE tag_id IN ({ids})))',
    );
    const matched = matchedCte(
      execution,
      clause(
        `e.id, e.registration_opens_at, e.registration_deadline_at, e.team_min, e.team_max,
         e.has_conflicts, e.first_seen_at, ${trusted.sql} AS trusted,
         ${category.sql} AS interest_category, ${tag.sql} AS interest_tag`,
        ...trusted.params,
        ...category.params,
        ...tag.params,
      ),
    );
    if (matched === undefined) return [];
    const expression = scoreExpression(score);
    const after = execution.after;
    const keyset =
      after === undefined
        ? undefined
        : clause(
            '(m.sk < ? OR (m.sk = ? AND (m.tie > ? OR (m.tie = ? AND m.id > ?))))',
            after.sortKey,
            after.sortKey,
            after.tie ?? UNKNOWN_DEADLINE_KEY,
            after.tie ?? UNKNOWN_DEADLINE_KEY,
            after.id,
          );
    const ranker = rankerColumns(execution);
    const sql = `${matched.sql},
      ranked AS (
        SELECT m.id, m.distance_km, m.text_score, ${score.hasText ? BEST : 'NULL'} AS best, ${expression.sql} AS sk,
          coalesce(m.registration_deadline_at, ${String(UNKNOWN_DEADLINE_KEY)}) AS tie,
          count(*) OVER () AS total
        FROM matched m
      ),
      page AS MATERIALIZED (
        SELECT * FROM ranked m ${keyset === undefined ? '' : `WHERE ${keyset.sql}`}
        ORDER BY m.sk DESC, m.tie ASC, m.id ASC LIMIT ?
      )
      SELECT ${CARD_COLUMNS}, p.distance_km, p.text_score, p.best, p.sk, p.tie, p.total, ${ranker.sql}
      FROM page p JOIN events e ON e.id = p.id
      ORDER BY p.sk DESC, p.tie ASC, p.id ASC`;
    return this.#db.raw
      .prepare(sql)
      .all(
        ...matched.params,
        ...expression.params,
        ...(keyset?.params ?? []),
        execution.plan.limit + 1,
        ...ranker.params,
      ) as SearchRow[];
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

  /** Source id → name and trust rank, for TRUSTED_SOURCE. The table has a handful of rows. */
  sourceTrust(): Map<string, { name: string; trustRank: number }> {
    const rows = this.#db.raw
      .prepare('SELECT id, name, trust_rank AS trustRank FROM sources')
      .all() as { id: string; name: string; trustRank: number }[];
    return new Map(rows.map((row) => [row.id, { name: row.name, trustRank: row.trustRank }]));
  }

  /** Active categories, for interest matching and facet labels. */
  activeCategories(): { id: string; name: string; slug: string }[] {
    return this.#db.raw
      .prepare(
        'SELECT id, name, slug FROM categories WHERE is_active = 1 ORDER BY sort_order, name',
      )
      .all() as { id: string; name: string; slug: string }[];
  }

  /** The user's interest tags (§6.2 `user_interest_tags`). */
  interestTags(
    userId: string,
  ): { id: string; name: string; normalized: string; aliasesJson: string }[] {
    return this.#db.raw
      .prepare(
        `SELECT t.id, t.name, t.normalized, t.aliases_json AS aliasesJson FROM user_interest_tags u
         JOIN tags t ON t.id = u.tag_id WHERE u.user_id = ? ORDER BY t.id`,
      )
      .all(userId) as { id: string; name: string; normalized: string; aliasesJson: string }[];
  }

  /** The categories one event carries (not suppressed, category active). */
  categoriesOf(eventId: string): EventCategoryRef[] {
    return this.#db.raw
      .prepare(
        `SELECT c.id, c.name, c.slug FROM event_categories ec JOIN categories c ON c.id = ec.category_id
         WHERE ec.event_id = ? AND ec.is_suppressed = 0 AND c.is_active = 1 ORDER BY c.sort_order, c.name`,
      )
      .all(eventId) as EventCategoryRef[];
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

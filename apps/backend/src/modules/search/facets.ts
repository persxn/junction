import {
  DISTANCE_BUCKETS_KM,
  FACET_VALUES_MAX,
  type Facets,
  type RegState,
} from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';
import {
  assembleFacets,
  rankCategories,
  type CategoryLabel,
  type FacetOptions,
  type RegStateTally,
} from './domain/facets.js';
import type { QueryPlan } from './domain/normalize.js';
import { BM25_WEIGHTS } from './repo.js';
import {
  and,
  clause,
  filterParts,
  LOCATED,
  placeholders,
  REG_STATE,
  textCte,
  type Clause,
  type TextMatch,
} from './sql.js';

/**
 * The facet statement (§8.2, WP-15b step 6). One CTE of matching rows — every
 * filter except the five families', which become 0/1 columns — materialized
 * once and counted five ways in a single round trip. Each family is counted
 * with its own column left out, so "switching to another type would give N"
 * is a number the list really returns (`domain/facets.ts` states the rule).
 */

export interface FacetExecution {
  readonly plan: QueryPlan;
  readonly text?: TextMatch;
  readonly userId: string;
  readonly options: FacetOptions;
  readonly categories: readonly CategoryLabel[];
  /** The same "closing soon" edge the planner and the ranker use. */
  readonly closingSoonUntil: number;
}

/** `grid`: a JSON array of one (type, mode, state) group's sums; `category`: id and count. */
interface TallyRow {
  readonly f: 'grid' | 'category';
  readonly v: string | null;
  readonly n: number;
}

const flag = (part: Clause | undefined): Clause =>
  part === undefined ? clause('1') : clause(`(${part.sql})`, ...part.params);

export class FacetRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  facets(execution: FacetExecution): Facets {
    const { plan } = execution;
    const cte = execution.text === undefined ? undefined : textCte(execution.text, BM25_WEIGHTS);
    if (execution.text !== undefined && cte === undefined) {
      return this.#assemble(execution, []);
    }
    const parts = filterParts(plan, execution.userId);
    const base = and(parts.base);
    const flags = {
      type: flag(parts.eventTypes),
      mode: flag(parts.modes),
      cat: flag(parts.categories),
      reg: flag(parts.registration),
      regRange: flag(parts.registrationRange),
    };
    // Distance flags from the one computed `d` (the filter's bounding box and
    // haversine would otherwise run twice more per row). Same predicate as
    // `sql.ts`'s distance clause: within the radius, or admitted as ONLINE /
    // unknown-location by A6.
    const d = plan.distance;
    const distanceFlag = (includeOnline: boolean): string =>
      d === undefined
        ? '1'
        : [
            `(d IS NOT NULL AND d <= ${String(d.maxKm)})`,
            ...(includeOnline ? ['online'] : []),
            ...(d.includeUnknown ? ['unlocated'] : []),
          ].join(' OR ');
    const pDist = `(${distanceFlag(d?.includeOnline ?? false)})`;
    const pDistOnline = `(${distanceFlag(true)})`;
    const campus = plan.campus;
    const distance =
      campus === undefined
        ? clause('NULL')
        : clause(
            `CASE WHEN ${LOCATED} THEN haversine_km(?, ?, e.lat, e.lon) END`,
            campus.lat,
            campus.lon,
          );
    const closingSoonUntil = execution.closingSoonUntil;
    const source =
      cte === undefined
        ? 'FROM events e'
        : 'FROM text_hits t CROSS JOIN events e ON e.rowid = t.rid';

    // Two scans of the materialized base, not five: one GROUP BY over
    // (type, mode, state) whose conditional sums give three families and the
    // distance buckets at once, and the category join.
    const forType = `p_mode AND p_cat AND p_reg AND ${pDist}`;
    const forMode = `p_type AND p_cat AND p_reg AND ${pDistOnline}`;
    const forState = `p_type AND p_mode AND p_cat AND ${pDist}`;
    const forDistance = 'p_type AND p_mode AND p_cat AND p_reg';
    const buckets = DISTANCE_BUCKETS_KM.map(
      (km) => `sum(${forDistance} AND d <= ${String(km)})`,
    ).join(', ');
    const sql = `WITH ${cte === undefined ? '' : `${cte.sql},`}
      base AS MATERIALIZED (
        SELECT e.id, e.event_type AS et, e.mode AS md, (${REG_STATE}) AS rs,
          (e.registration_deadline_at IS NULL) AS dz, ${distance.sql} AS d,
          (e.mode = 'ONLINE') AS online, (e.mode <> 'ONLINE' AND NOT (${LOCATED})) AS unlocated,
          ${flags.type.sql} AS p_type, ${flags.mode.sql} AS p_mode, ${flags.cat.sql} AS p_cat,
          ${flags.reg.sql} AS p_reg, ${flags.regRange.sql} AS p_reg_range
        ${source}
        WHERE ${base.sql}
      )
      SELECT 'grid' AS f, json_array(et, md, rs,
          sum(${forType}), sum(${forMode}),
          sum(${forState} AND p_reg_range), sum(${forState} AND p_reg_range AND dz), sum(${forState} AND dz),
          ${buckets}, sum(${forDistance} AND online), sum(${forDistance} AND unlocated), sum(${forDistance})) AS v,
          0 AS n
        FROM base GROUP BY et, md, rs
      UNION ALL SELECT 'category', ec.category_id, count(*)
        FROM base b CROSS JOIN event_categories ec ON ec.event_id = b.id AND ec.is_suppressed = 0
        WHERE p_type AND p_mode AND p_reg AND ${pDist} GROUP BY ec.category_id`;
    const rows = this.#db.raw
      .prepare(sql)
      .all(
        ...(cte?.params ?? []),
        plan.now,
        plan.now,
        closingSoonUntil,
        ...distance.params,
        ...flags.type.params,
        ...flags.mode.params,
        ...flags.cat.params,
        ...flags.reg.params,
        ...flags.regRange.params,
        ...base.params,
      ) as TallyRow[];
    return this.#assemble(execution, rows, () => this.#categoryOther(execution, rows));
  }

  #assemble(execution: FacetExecution, rows: readonly TallyRow[], other?: () => number): Facets {
    const eventType = new Map<string, number>();
    const mode = new Map<string, number>();
    const states = new Map<
      RegState,
      { known: number; knownWithoutDeadline: number; withoutDeadline: number }
    >();
    const within = new Map<number, number>(DISTANCE_BUCKETS_KM.map((km) => [km, 0]));
    let online = 0;
    let unlocated = 0;
    let all = 0;
    const add = (map: Map<string, number>, key: string, value: number): void => {
      map.set(key, (map.get(key) ?? 0) + value);
    };
    for (const row of rows) {
      if (row.f !== 'grid' || row.v === null) continue;
      const [et, md, rs, nType, nMode, known, knownZ, z, ...rest] = JSON.parse(row.v) as [
        string,
        string,
        RegState,
        ...(number | null)[],
      ];
      add(eventType, et, nType ?? 0);
      add(mode, md, nMode ?? 0);
      const state = states.get(rs) ?? { known: 0, knownWithoutDeadline: 0, withoutDeadline: 0 };
      state.known += known ?? 0;
      state.knownWithoutDeadline += knownZ ?? 0;
      state.withoutDeadline += z ?? 0;
      states.set(rs, state);
      DISTANCE_BUCKETS_KM.forEach((km, index) => {
        within.set(km, (within.get(km) ?? 0) + (rest[index] ?? 0));
      });
      const tail = rest.slice(DISTANCE_BUCKETS_KM.length);
      online += tail[0] ?? 0;
      unlocated += tail[1] ?? 0;
      all += tail[2] ?? 0;
    }
    const registration: RegStateTally[] = [...states].map(([state, tally]) => ({
      state,
      ...tally,
    }));
    const category = new Map(
      rows.filter((row) => row.f === 'category' && row.v !== null).map((row) => [row.v!, row.n]),
    );
    return assembleFacets(
      {
        eventType,
        mode,
        registration,
        category,
        ...(execution.categories.length > FACET_VALUES_MAX && other !== undefined
          ? { categoryOther: other() }
          : {}),
        distance:
          execution.plan.campus === undefined ? undefined : { within, online, unlocated, all },
        all,
      },
      execution.categories,
      execution.options,
    );
  }

  /** Distinct rows holding a category outside the top 20 — a second statement, only past 20 categories. */
  #categoryOther(execution: FacetExecution, rows: readonly TallyRow[]): number {
    const counts = new Map(
      rows.filter((row) => row.f === 'category').map((row) => [row.v!, row.n]),
    );
    const rest = rankCategories(execution.categories, counts)
      .slice(FACET_VALUES_MAX)
      .map((category) => category.id);
    if (rest.length === 0) return 0;
    const parts = filterParts(execution.plan, execution.userId);
    const where = and([
      ...parts.base,
      ...[parts.eventTypes, parts.modes, parts.registration, parts.distance].filter(
        (part): part is Clause => part !== undefined,
      ),
    ]);
    const cte = execution.text === undefined ? undefined : textCte(execution.text, BM25_WEIGHTS);
    const source =
      cte === undefined
        ? 'FROM events e'
        : 'FROM text_hits t CROSS JOIN events e ON e.rowid = t.rid';
    const row = this.#db.raw
      .prepare(
        `WITH ${cte === undefined ? '' : `${cte.sql},`} hits AS (SELECT e.id ${source} WHERE ${where.sql})
         SELECT count(DISTINCT h.id) AS n FROM hits h JOIN event_categories ec ON ec.event_id = h.id
         WHERE ec.is_suppressed = 0 AND ec.category_id IN (${placeholders(rest)})`,
      )
      .get(...(cte?.params ?? []), ...where.params, ...rest) as { n: number };
    return row.n;
  }
}

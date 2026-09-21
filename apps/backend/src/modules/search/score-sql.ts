import type { RankingThresholds, RankingWeights } from './settings.js';
import { clause, type Clause } from './sql.js';

/**
 * RELEVANCE's score as SQL, so the order and the page happen in the database
 * instead of shipping every matching row to JavaScript (measured: 19k rows cost
 * ~35 ms to read and score, the whole budget).
 *
 * **This mirrors `domain/rank.ts`, which stays the definition.** Every boost is
 * added in integer milli-points — `round(points × 1000)` — exactly as
 * `rank.ts` rounds each reason, and `round` agrees with `Math.round` for the
 * non-negative values here, so `rank()`'s score × 1000 equals the `ms` column
 * for every row. `ranking.test.ts` asserts the SQL order is the order `rank.ts`
 * scores imply, over generated queries; change one, change both.
 *
 * Column names read from the `matched` CTE: `text_score`, `registration_opens_at`, `registration_deadline_at`,
 * `distance_km`, `team_min`, `team_max`, `has_conflicts`, `first_seen_at`,
 * `trusted`, `interest_category`, `interest_tag`.
 */

export interface ScoreParams {
  readonly now: number;
  readonly weights: RankingWeights;
  readonly thresholds: RankingThresholds;
  readonly radiusKm: number | undefined;
  readonly teamSizeFits: number | undefined;
  /** Without text there is no text term, and no window pass to find the best bm25. */
  readonly hasText: boolean;
}

/** The set's best bm25, as a window over the whole result (shares its pass with `total`). */
export const BEST = 'min(m.text_score) OVER ()';

const DAY_MS = 86_400_000;
const milli = (points: number): number => Math.round(points * 1000);

export function scoreExpression(params: ScoreParams): Clause {
  const { weights: w, thresholds: t, now } = params;
  const n = params.teamSizeFits;
  const radius = params.radiusKm;
  const parts: Clause[] = [
    params.hasText
      ? clause(
          `CASE WHEN m.text_score < 0 AND (${BEST}) < 0 THEN round((? * min(1.0, m.text_score / (${BEST}))) * 1000) ELSE 0 END`,
          w.text,
        )
      : clause('0'),
    clause(
      `CASE WHEN m.registration_deadline_at IS NOT NULL
             AND NOT (m.registration_opens_at IS NOT NULL AND m.registration_opens_at > ?)
             AND m.registration_deadline_at >= ?
        THEN CASE WHEN m.registration_deadline_at <= ? THEN ? ELSE ? END ELSE 0 END`,
      now,
      now,
      now + t.closingSoonDays * DAY_MS,
      milli(w.closingSoon),
      milli(w.registrationOpen),
    ),
    radius === undefined
      ? clause('0')
      : clause(
          'CASE WHEN m.distance_km IS NOT NULL AND m.distance_km <= ? THEN ? ELSE 0 END',
          radius,
          milli(w.withinRadius),
        ),
    clause('CASE WHEN m.interest_category THEN ? ELSE 0 END', milli(w.categoryMatch)),
    clause('CASE WHEN m.interest_tag THEN ? ELSE 0 END', milli(w.tagMatch)),
    n === undefined
      ? clause('0')
      : clause(
          `CASE WHEN (m.team_min IS NOT NULL OR m.team_max IS NOT NULL)
             AND coalesce(m.team_min, 1) <= ? AND coalesce(m.team_max, ?) >= ? THEN ? ELSE 0 END`,
          n,
          n,
          n,
          milli(w.teamSizeFits),
        ),
    clause('CASE WHEN m.trusted THEN ? ELSE 0 END', milli(w.trustedSource)),
    clause('CASE WHEN m.has_conflicts = 0 THEN ? ELSE 0 END', milli(w.noConflicts)),
    clause(
      'CASE WHEN m.first_seen_at >= ? THEN ? ELSE 0 END',
      now - t.recentlyAddedDays * DAY_MS,
      milli(w.recentlyAdded),
    ),
  ];
  return clause(
    `CAST(${parts.map((part) => `(${part.sql})`).join(' + ')} AS INTEGER)`,
    ...parts.flatMap((part) => part.params),
  );
}

/** A deadline as the tie-break orders it: soonest first, unknown last. */
export const UNKNOWN_DEADLINE_KEY = 8_640_000_000_000_000;

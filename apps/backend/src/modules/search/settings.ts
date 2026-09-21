import { z } from 'zod';

import { define } from '../../platform/settings.js';

/**
 * Ranking weights and thresholds (§8.4, D-18, WP-15b). The only place the
 * numbers exist; the scorer reads them per query, so an administrator retunes
 * the order by writing a setting, with no restart.
 *
 * Defaults, in one block (points; RELEVANCE's score is their sum):
 *
 * | Reason            | Points | Fires when                                                     |
 * |-------------------|-------:|----------------------------------------------------------------|
 * | TEXT_MATCH        | ≤ 40   | text given: 40 × bm25 / best bm25 in the result set (0 for a substring-only hit) |
 * | CLOSING_SOON      | 15     | registration closes within `closingSoonDays` (7, §6.4/§12)     |
 * | REGISTRATION_OPEN | 10     | registration open and closing later than that                  |
 * | CATEGORY_MATCH    | 20     | a category of the event is one of the professor's interests    |
 * | TAG_MATCH         | 15     | a tag of the event is one of the professor's interests         |
 * | WITHIN_RADIUS     | 10     | within `maxDistanceKm`, or `geography.nearbyRadiusKm` without one |
 * | TEAM_SIZE_FITS    | 5      | `teamSizeFits` asked for and the known team size allows it     |
 * | TRUSTED_SOURCE    | 5      | listed by a source with `trust_rank` ≥ `trustedSourceMinRank` (40) |
 * | NO_CONFLICTS      | 5      | `has_conflicts = false`                                        |
 * | RECENTLY_ADDED    | 5      | first seen within `recentlyAddedDays` (7)                      |
 *
 * Ties break by registration deadline (soonest first, unknown last), then id.
 */

const Points = z.number().min(0).max(100);

export const RankingWeights = z
  .object({
    text: Points,
    closingSoon: Points,
    registrationOpen: Points,
    categoryMatch: Points,
    tagMatch: Points,
    withinRadius: Points,
    teamSizeFits: Points,
    trustedSource: Points,
    noConflicts: Points,
    recentlyAdded: Points,
  })
  .strict();
export type RankingWeights = z.infer<typeof RankingWeights>;

export const RankingThresholds = z
  .object({
    closingSoonDays: z.int().min(1).max(30),
    recentlyAddedDays: z.int().min(1).max(90),
    trustedSourceMinRank: z.int().min(0).max(1000),
  })
  .strict();
export type RankingThresholds = z.infer<typeof RankingThresholds>;

export const RANKING_WEIGHTS = define('search.ranking.weights', {
  schema: RankingWeights,
  default: {
    text: 40,
    closingSoon: 15,
    registrationOpen: 10,
    categoryMatch: 20,
    tagMatch: 15,
    withinRadius: 10,
    teamSizeFits: 5,
    trustedSource: 5,
    noConflicts: 5,
    recentlyAdded: 5,
  },
  description:
    'Points each "Why relevant?" reason adds to a search result’s relevance score (§8.4).',
});

export const RANKING_THRESHOLDS = define('search.ranking.thresholds', {
  schema: RankingThresholds,
  default: { closingSoonDays: 7, recentlyAddedDays: 7, trustedSourceMinRank: 40 },
  description:
    'When "closing soon" and "recently added" start, and the source trust rank that counts as trusted (§8.4, §12).',
});

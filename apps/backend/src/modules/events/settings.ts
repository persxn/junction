import { DedupConfig, DedupWeights } from '@compintel/contracts';
import { z } from 'zod';

import { define, type SettingsStore } from '../../platform/settings.js';

/**
 * The dedup thresholds and weights (§7.5, ruling R65).
 *
 * These are the only place the numbers exist. Scoring reads them at call time
 * through {@link readDedupConfig}, so a fixture — or an administrator — retunes
 * the matcher by writing a setting, with no code change and no restart.
 */

/** ≥ this → the two records are one event, merged without asking (§7.5). */
export const DEDUP_AUTO_MERGE_THRESHOLD = define('dedup.autoMergeThreshold', {
  schema: z.number().gt(0).max(1),
  default: 0.9,
  description: 'Duplicate score at or above which two records are merged automatically (§7.5).',
});

/** ≥ this and below the auto-merge threshold → a PENDING review row (§7.5). */
export const DEDUP_CANDIDATE_THRESHOLD = define('dedup.candidateThreshold', {
  schema: z.number().gt(0).max(1),
  default: 0.7,
  description: 'Duplicate score at or above which a pair is offered to an administrator (§7.5).',
});

/** §7.5's four feature weights; the schema checks that they sum to 1.0 (R65). */
export const DEDUP_WEIGHTS = define('dedup.weights', {
  schema: DedupWeights,
  default: { title: 0.45, organizer: 0.2, dateProximity: 0.2, locationMode: 0.15 },
  description: 'How much title, organizer, dates and place/mode each count in the duplicate score.',
});

/** The defaults as one object, used when a stored combination breaks R65's order check. */
export function defaultDedupConfig(): DedupConfig {
  return {
    autoMergeThreshold: DEDUP_AUTO_MERGE_THRESHOLD.default,
    candidateThreshold: DEDUP_CANDIDATE_THRESHOLD.default,
    weights: DEDUP_WEIGHTS.default,
  };
}

/**
 * The three settings as one validated object.
 *
 * Each key is validated on its own by the store; the one rule that spans two
 * keys — the candidate threshold sits below the auto-merge one — is checked
 * here. A combination that breaks it falls back to the defaults, with the
 * reason passed to `onInvalid`, rather than letting an empty grey band merge
 * every near-duplicate silently.
 */
export function readDedupConfig(
  settings: SettingsStore,
  onInvalid: (reason: string) => void = () => undefined,
): DedupConfig {
  const parsed = DedupConfig.safeParse({
    autoMergeThreshold: settings.get(DEDUP_AUTO_MERGE_THRESHOLD),
    candidateThreshold: settings.get(DEDUP_CANDIDATE_THRESHOLD),
    weights: settings.get(DEDUP_WEIGHTS),
  });
  if (parsed.success) {
    return parsed.data;
  }
  onInvalid(parsed.error.issues.map((issue) => issue.message).join('; '));
  return defaultDedupConfig();
}

import type { DedupConfig, DedupDecision, DedupScore, DedupWeights } from '@compintel/contracts';

import {
  dateProximity,
  datesOverlap,
  locationModeAgreement,
  organizerSimilarity,
  urlMatch,
  type Dated,
  type Linked,
  type Placed,
} from './features.js';
import { titleSimilarity, trigramOverlap } from './title.js';

/**
 * §7.5 end to end: which stored events are worth comparing, how alike they
 * are, and what to do about it. Pure — the thresholds and weights arrive as an
 * argument (R65), read from settings by the caller at call time.
 */

/** What matching needs to know about either side. A Drizzle `events` row fits. */
export interface DedupSubject extends Dated, Placed, Linked {
  readonly title: string;
  readonly organizerName?: string | null | undefined;
  readonly editionYear?: number | null | undefined;
}

/**
 * §7.5's "title trigram overlap", as a floor on the trigram Jaccard. It is a
 * candidate *prefilter*, not a score: anything past it is still scored and
 * decided by the R65 settings.
 */
export const TRIGRAM_PREFILTER = 0.2;

/** R64: both years known and different. A null on either side is not a difference. */
export function editionsDiffer(left: DedupSubject, right: DedupSubject): boolean {
  return (
    left.editionYear != null && right.editionYear != null && left.editionYear !== right.editionYear
  );
}

/**
 * §7.5's candidate generation for one pair: an identical normalized URL is a
 * near-certain match; otherwise the same edition year (or an unknown one), and
 * dates in each other's window, and some title overlap.
 */
export function isCandidate(left: DedupSubject, right: DedupSubject): boolean {
  if (urlMatch(left, right) || urlMatch(right, left)) {
    return true;
  }
  return (
    !editionsDiffer(left, right) &&
    datesOverlap(left, right) &&
    trigramOverlap(left.title, right.title) >= TRIGRAM_PREFILTER
  );
}

/** The stored events worth scoring against `subject`. */
export function candidates<T extends DedupSubject>(
  subject: DedupSubject,
  index: readonly T[],
): T[] {
  return index.filter((event) => isCandidate(subject, event));
}

/** §7.5's weighted sum; a URL match scores 1.0 whatever the features say. */
export function score(left: DedupSubject, right: DedupSubject, weights: DedupWeights): DedupScore {
  const features = {
    title: titleSimilarity(left.title, right.title),
    organizer: organizerSimilarity(left.organizerName, right.organizerName),
    dateProximity: dateProximity(left, right),
    locationMode: locationModeAgreement(left, right),
    urlMatch: urlMatch(left, right) || urlMatch(right, left),
  };
  const weighted =
    weights.title * features.title +
    weights.organizer * features.organizer +
    weights.dateProximity * features.dateProximity +
    weights.locationMode * features.locationMode;
  return {
    total: features.urlMatch ? 1 : Math.min(1, Math.max(0, weighted)),
    features,
  };
}

/**
 * §7.5's decision, with R64 first: two known, different edition years are NEW
 * and nothing else is asked — not the URL, not the score.
 */
export function decide(
  left: DedupSubject,
  right: DedupSubject,
  result: DedupScore,
  config: DedupConfig,
): DedupDecision {
  if (editionsDiffer(left, right)) {
    return 'NEW';
  }
  if (result.total >= config.autoMergeThreshold) {
    return 'AUTO_MERGE';
  }
  if (result.total >= config.candidateThreshold) {
    return 'CANDIDATE';
  }
  return 'NEW';
}

export interface Assessment<T> {
  readonly target: T;
  readonly score: DedupScore;
  readonly decision: DedupDecision;
}

/**
 * Every candidate, scored and decided, best first. Ties go to the
 * `tieBreak` order the caller supplies (the linker passes "seen first").
 */
export function assess<T extends DedupSubject>(
  subject: DedupSubject,
  index: readonly T[],
  config: DedupConfig,
  tieBreak: (a: T, b: T) => number = () => 0,
): Assessment<T>[] {
  return candidates(subject, index)
    .map((target) => {
      const result = score(subject, target, config.weights);
      return { target, score: result, decision: decide(subject, target, result, config) };
    })
    .sort((a, b) => b.score.total - a.score.total || tieBreak(a.target, b.target));
}

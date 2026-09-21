import type { EventCandidate } from '@compintel/contracts';

/**
 * `events.quality_score`, 0–100 (§6.2 Quality).
 *
 * **Provisional and deliberately crude.** It is the share of the fields a
 * professor actually needs that the sources managed to give us — nothing
 * cleverer. WP-15b's ranking and WP-16b's provenance drawer are what will tune
 * it, once there is real data to tune against; inventing a weighted model now
 * would be fitting a curve to two fixtures.
 *
 * What it is *for* is worth stating, because it shapes the weights. It is not a
 * measure of how good an event is — a small college hackathon with complete
 * information scores higher than a famous one with none. It is a measure of how
 * much we know, so the feed can push the half-scraped rows down and the UI can
 * say "this listing is thin" rather than presenting a blank as a fact.
 */

/** What a professor decides with, roughly in the order they look for it. */
const WEIGHTS = {
  startsAt: 20,
  registrationDeadlineAt: 20,
  mode: 10,
  place: 10,
  descriptionMd: 10,
  officialUrl: 10,
  teamSize: 8,
  fee: 6,
  organizerName: 6,
} as const;

const TOTAL = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);

/** The facts the score looks at, as a resolved `events` row states them. */
export interface QualityInput {
  readonly startsAt: number | null;
  readonly registrationDeadlineAt: number | null;
  readonly mode: string;
  readonly city: string | null;
  readonly venueName: string | null;
  readonly descriptionMd: string | null;
  readonly officialUrl: string | null;
  readonly teamMin: number | null;
  readonly teamMax: number | null;
  readonly feeKnown: boolean;
  readonly organizerName: string | null;
}

export function qualityScoreOf(input: QualityInput): number {
  let earned = 0;
  const has = (value: unknown): boolean => value !== null && value !== undefined;

  if (has(input.startsAt)) {
    earned += WEIGHTS.startsAt;
  }
  if (has(input.registrationDeadlineAt)) {
    earned += WEIGHTS.registrationDeadlineAt;
  }
  // An UNKNOWN mode is a field we have, holding the information that we do not
  // know — which is not the same as having told the professor anything.
  if (input.mode !== 'UNKNOWN') {
    earned += WEIGHTS.mode;
  }
  if (has(input.city) || has(input.venueName)) {
    earned += WEIGHTS.place;
  }
  if (has(input.descriptionMd)) {
    earned += WEIGHTS.descriptionMd;
  }
  if (has(input.officialUrl)) {
    earned += WEIGHTS.officialUrl;
  }
  if (has(input.teamMin) || has(input.teamMax)) {
    earned += WEIGHTS.teamSize;
  }
  if (input.feeKnown) {
    earned += WEIGHTS.fee;
  }
  if (has(input.organizerName)) {
    earned += WEIGHTS.organizerName;
  }

  return Math.round((earned / TOTAL) * 100);
}

/** The same score for a candidate that has not been stored yet. */
export function qualityScore(candidate: EventCandidate): number {
  return qualityScoreOf({
    startsAt: candidate.startsAt?.at ?? null,
    registrationDeadlineAt: candidate.registrationDeadlineAt?.at ?? null,
    mode: candidate.mode.value,
    city: candidate.place?.city ?? null,
    venueName: candidate.place?.venueName ?? null,
    descriptionMd: candidate.descriptionMd ?? null,
    officialUrl: candidate.officialUrl ?? null,
    teamMin: candidate.teamSize?.min ?? null,
    teamMax: candidate.teamSize?.max ?? null,
    feeKnown: candidate.fee?.known === true,
    organizerName: candidate.organizerName ?? null,
  });
}

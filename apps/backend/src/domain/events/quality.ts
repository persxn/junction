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

export function qualityScore(candidate: EventCandidate): number {
  let earned = 0;

  if (candidate.startsAt !== undefined) {
    earned += WEIGHTS.startsAt;
  }
  if (candidate.registrationDeadlineAt !== undefined) {
    earned += WEIGHTS.registrationDeadlineAt;
  }
  // An UNKNOWN mode is a field we have, holding the information that we do not
  // know — which is not the same as having told the professor anything.
  if (candidate.mode.value !== 'UNKNOWN') {
    earned += WEIGHTS.mode;
  }
  if (candidate.place?.city !== undefined || candidate.place?.venueName !== undefined) {
    earned += WEIGHTS.place;
  }
  if (candidate.descriptionMd !== undefined) {
    earned += WEIGHTS.descriptionMd;
  }
  if (candidate.officialUrl !== undefined) {
    earned += WEIGHTS.officialUrl;
  }
  if (candidate.teamSize?.min !== undefined || candidate.teamSize?.max !== undefined) {
    earned += WEIGHTS.teamSize;
  }
  if (candidate.fee?.known === true) {
    earned += WEIGHTS.fee;
  }
  if (candidate.organizerName !== undefined) {
    earned += WEIGHTS.organizerName;
  }

  return Math.round((earned / TOTAL) * 100);
}

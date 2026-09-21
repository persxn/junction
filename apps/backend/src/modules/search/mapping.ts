import type { EventCore, RankedEventListItem } from '@compintel/contracts';

import type { EventRow } from '../../db/schema/index.js';
import { haversineKm } from '../../domain/geo/distance.js';
import type { Ranked, RankRow } from './domain/rank.js';
import type { SearchRow } from './repo.js';

/** Rows to API shapes: the ranked card and the core event (WP-15a, WP-15b). */

export function toListItem(row: SearchRow, sources: string[], ranked: Ranked): RankedEventListItem {
  return {
    id: row.id,
    title: row.title,
    organizerName: row.organizer_name,
    eventType: row.event_type,
    mode: row.mode,
    distanceKm: row.distance_km,
    registrationDeadlineAt: row.registration_deadline_at,
    registrationDeadlinePrecision: row.registration_deadline_precision ?? 'UNKNOWN',
    startsAt: row.starts_at ?? null,
    datePrecision: row.date_precision ?? 'UNKNOWN',
    prize: {
      text: row.prize_text,
      totalMinor: row.prize_total_minor,
      currency: row.prize_currency,
    },
    teamMin: row.team_min,
    teamMax: row.team_max,
    sources,
    hasConflicts: row.has_conflicts === 1,
    score: ranked.score,
    reasons: ranked.reasons,
  };
}

/** Lookups made once per query for the ranker. */
export interface RankLookups {
  readonly sources: ReadonlyMap<string, { name: string; trustRank: number }>;
  readonly trustedMinRank: number;
  readonly categoryNames: ReadonlyMap<string, string>;
  readonly tagNames: ReadonlyMap<string, string>;
}

const namesOf = (ids: string | null | undefined, map: ReadonlyMap<string, string>): string[] =>
  ids == null
    ? []
    : ids
        .split(',')
        .map((id) => map.get(id))
        .filter((name): name is string => name !== undefined)
        .sort();

/** A card row as the ranker reads it (the page: names included). */
export function toRankRow(row: SearchRow, lookups: RankLookups): RankRow {
  const top = row.top_source_id === null ? undefined : lookups.sources.get(row.top_source_id);
  return {
    id: row.id,
    mode: row.mode,
    registrationOpensAt: row.registration_opens_at,
    registrationDeadlineAt: row.registration_deadline_at,
    registrationDeadlinePrecision: row.registration_deadline_precision,
    startsAt: row.starts_at,
    datePrecision: row.date_precision,
    distanceKm: row.distance_km,
    teamMin: row.team_min,
    teamMax: row.team_max,
    prizeTotalMinor: row.prize_total_minor,
    prizeCurrency: row.prize_currency,
    hasConflicts: row.has_conflicts === 1,
    firstSeenAt: row.first_seen_at,
    textScore: row.text_score,
    trustedSource:
      top !== undefined && top.trustRank >= lookups.trustedMinRank ? top.name : undefined,
    interestCategories: namesOf(row.interest_category_ids, lookups.categoryNames),
    interestTags: namesOf(row.interest_tag_ids, lookups.tagNames),
  };
}

export function distanceOf(event: EventRow, campus: { lat: number; lon: number }): number | null {
  const precise = ['EXACT', 'INSTITUTION', 'CITY'].includes(event.geoPrecision);
  if (event.mode === 'ONLINE' || !precise || event.lat === null || event.lon === null) {
    return null;
  }
  return haversineKm(campus, { lat: event.lat, lon: event.lon });
}

export function toCore(
  event: EventRow,
  extra: Pick<EventCore, 'distanceKm' | 'deadlines' | 'sources' | 'categories'>,
): EventCore {
  return {
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    mode: event.mode,
    organizerName: event.organizerName,
    organizerKind: event.organizerKind,
    city: event.city,
    countryCode: event.countryCode,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    registrationDeadlineAt: event.registrationDeadlineAt,
    registrationDeadlinePrecision: event.registrationDeadlinePrecision,
    datePrecision: event.datePrecision,
    feeKnown: event.feeKnown,
    feeMinor: event.feeMinor,
    feeCurrency: event.feeCurrency,
    teamMin: event.teamMin,
    teamMax: event.teamMax,
    editionYear: event.editionYear,
    isRecurringRound: event.isRecurringRound,
    cancellation: event.cancellation,
    visibility: event.visibility,
    qualityScore: event.qualityScore,
    hasConflicts: event.hasConflicts,
    officialUrl: event.officialUrl,
    normalizedTitle: event.normalizedTitle,
    seriesId: event.seriesId,
    hostInstitutionId: event.hostInstitutionId,
    summary: event.summary,
    descriptionMd: event.descriptionMd,
    prizeText: event.prizeText,
    prizeTotalMinor: event.prizeTotalMinor,
    prizeCurrency: event.prizeCurrency,
    eligibilityText: event.eligibilityText,
    requirementsText: event.requirementsText,
    submissionRequirementsText: event.submissionRequirementsText,
    venueName: event.venueName,
    state: event.state,
    lat: event.lat,
    lon: event.lon,
    geoPrecision: event.geoPrecision,
    timezone: event.timezone,
    registrationOpensAt: event.registrationOpensAt,
    submissionDeadlineAt: event.submissionDeadlineAt,
    feeText: event.feeText,
    registrationUrl: event.registrationUrl,
    cancellationOrigin: event.cancellationOrigin,
    mergedIntoEventId: event.mergedIntoEventId,
    policyReason: event.policyReason,
    lastVerifiedAt: event.lastVerifiedAt,
    lastChangedAt: event.lastChangedAt,
    firstSeenAt: event.firstSeenAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    version: event.version,
    ...extra,
  };
}

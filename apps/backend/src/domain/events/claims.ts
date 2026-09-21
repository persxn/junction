import type { EventCandidate, OverrideField } from '@compintel/contracts';

/**
 * What one source record claims about each field of an event (§6.2
 * `event_field_claims`). Pure.
 *
 * Every field a source can speak to gets a claim, including "I say nothing"
 * (`null`), so that when a source stops stating a deadline its old claim is
 * replaced rather than left standing. The values are JSON strings because that
 * is what is stored, compared and — by resolution — copied onto the event
 * unchanged.
 */

/** The resolved place a geocoder produced for the candidate (WP-08b). */
export interface ClaimedPlace {
  readonly city?: string | undefined;
  readonly state?: string | undefined;
  readonly countryCode?: string | undefined;
  readonly lat?: number | undefined;
  readonly lon?: number | undefined;
  readonly geoPrecision: string;
  readonly institutionId?: string | undefined;
}

/** The fields a source can claim. The three state fields are a person's, never a scrape's. */
export const CLAIMED_FIELDS = [
  'title',
  'eventType',
  'organizerName',
  'organizerKind',
  'hostInstitutionId',
  'summary',
  'descriptionMd',
  'prizeText',
  'prizeTotalMinor',
  'prizeCurrency',
  'eligibilityText',
  'requirementsText',
  'submissionRequirementsText',
  'mode',
  'venueName',
  'city',
  'state',
  'countryCode',
  'lat',
  'lon',
  'geoPrecision',
  'timezone',
  'registrationOpensAt',
  'registrationDeadlineAt',
  'startsAt',
  'endsAt',
  'submissionDeadlineAt',
  'teamMin',
  'teamMax',
  'feeKnown',
  'feeMinor',
  'feeCurrency',
  'feeText',
  'officialUrl',
  'registrationUrl',
  'editionYear',
  'isRecurringRound',
] as const satisfies readonly OverrideField[];
export type ClaimedField = (typeof CLAIMED_FIELDS)[number];

function json(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/** One claim value per claimed field. */
export function claimValues(
  candidate: EventCandidate,
  place: ClaimedPlace,
): Record<ClaimedField, string | null> {
  const fee = candidate.fee;
  const knownFee = fee?.known === true;
  return {
    title: json(candidate.title),
    eventType: json(candidate.eventType.value),
    organizerName: json(candidate.organizerName),
    organizerKind: json(candidate.organizerKind?.value),
    hostInstitutionId: json(place.institutionId),
    summary: json(candidate.summary),
    descriptionMd: json(candidate.descriptionMd),
    prizeText: json(candidate.prize?.text),
    prizeTotalMinor: json(candidate.prize?.totalMinor),
    prizeCurrency: json(candidate.prize?.currency),
    eligibilityText: json(candidate.eligibilityText),
    requirementsText: json(candidate.requirementsText),
    submissionRequirementsText: json(candidate.submissionRequirementsText),
    mode: json(candidate.mode.value),
    venueName: json(candidate.place?.venueName),
    city: json(place.city ?? candidate.place?.city),
    state: json(place.state ?? candidate.place?.state),
    countryCode: json(place.countryCode ?? candidate.place?.countryCode),
    lat: json(place.lat),
    lon: json(place.lon),
    geoPrecision: json(place.geoPrecision),
    timezone: json(candidate.timezone),
    registrationOpensAt: json(candidate.registrationOpensAt?.at),
    registrationDeadlineAt: json(candidate.registrationDeadlineAt?.at),
    startsAt: json(candidate.startsAt?.at),
    endsAt: json(candidate.endsAt?.at),
    submissionDeadlineAt: json(candidate.submissionDeadlineAt?.at),
    teamMin: json(candidate.teamSize?.min),
    teamMax: json(candidate.teamSize?.max),
    // "Unknown fee" is no claim at all, never a claim that it is unknown —
    // otherwise a source that is silent about money would outvote one that
    // said "Free".
    feeKnown: knownFee ? 'true' : null,
    feeMinor: knownFee ? json(fee.minor) : null,
    feeCurrency: knownFee ? json(fee.currency) : null,
    feeText: json(fee?.text),
    officialUrl: json(candidate.officialUrl),
    registrationUrl: json(candidate.registrationUrl),
    editionYear: json(candidate.editionYear),
    isRecurringRound: json(candidate.isRecurringRound),
  };
}

export interface AlternateClaimValue {
  readonly field: OverrideField;
  readonly valueJson: string;
  readonly note: string;
}

/** R63's second claims, as stored alternates. */
export function alternateClaimValues(candidate: EventCandidate): AlternateClaimValue[] {
  return (candidate.alternateClaims ?? []).map((claim) => ({
    field: claim.field,
    valueJson: JSON.stringify(claim.value),
    note: claim.note,
  }));
}

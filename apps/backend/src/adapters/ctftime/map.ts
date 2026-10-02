import {
  EventCandidate,
  type CandidateEligibility,
  type CandidatePlace,
  type InstitutionKind,
  type OrganizerKind,
  type ParseWarning,
  type Uncertain,
} from '@compintel/contracts';

import { normalizeCandidate, redact, type RawCandidate } from '../../domain/normalize/index.js';
import type { GeocodeResult } from '../../modules/geo/geocoder.js';
import type { Clock } from '../../platform/time.js';
import { parseLocation, singleZoneOf } from '../../domain/geo/location.js';
import { eventPageUrl } from './paths.js';
import { prizeClaims, prizeFromText } from './prizes.js';
import type { CtftimeEvent } from './schema.js';

/**
 * One CTFtime event → one `EventCandidate` (`source-feasibility.md` §1.5).
 *
 * **Pure** (R52): no network, no database, no clock of its own. The geocoder
 * arrives as an argument — a read-only lookup over the gazetteer that answers
 * the same question the same way every time — so a golden file recorded today
 * means the same thing next year.
 *
 * The mapping is an explicit allowlist: every field below is read by name, and
 * a field CTFtime sends that is not read here (`participants`, `weight`,
 * `logo`, `live_feed`, `is_votable_now`, `public_votable`, `format_id`, and
 * whatever it adds next) never reaches the candidate. R50 would make a stray
 * key fail validation anyway; this makes it impossible to write one.
 */

/** What the mapper may ask about places and institutions. `Geocoder` satisfies it. */
export interface CtftimeGeo {
  resolve(place: CandidatePlace | undefined): GeocodeResult;
  institutionNamed(name: string): { readonly kind: InstitutionKind } | undefined;
}

export interface CtftimeMapContext {
  readonly clock: Clock;
  readonly sourceKey: string;
  /** `https://ctftime.org`; the record URL is built from it and the numeric id. */
  readonly origin: string;
  readonly geo: CtftimeGeo;
}

/** CTFtime reports whole hours; a gap under this is rounding, not disagreement. */
const DURATION_TOLERANCE_MS = 3_600_000;

const ORGANIZER_KIND_BY_INSTITUTION: Readonly<Record<InstitutionKind, OrganizerKind>> = {
  IIT: 'IIT',
  NIT: 'NIT',
  IIIT: 'IIIT',
  CENTRAL_UNIV: 'UNIVERSITY',
  STATE_UNIV: 'UNIVERSITY',
  PRIVATE_UNIV: 'UNIVERSITY',
  COLLEGE: 'COLLEGE',
  RESEARCH: 'OTHER',
  OTHER: 'OTHER',
};

export function mapCtftimeEvent(event: CtftimeEvent, ctx: CtftimeMapContext): EventCandidate {
  const id = String(event.id);
  const extra: ParseWarning[] = [];

  const organizers = event.organizers.map((organizer) => organizer.name.trim()).filter(Boolean);
  const [organizerName, ...coOrganizers] = organizers;

  // ---- Place and zone: only an on-site event has a venue -------------------
  const location = event.location.trim();
  const place = event.onsite ? placeOf(location, ctx.geo, extra) : undefined;
  const venueZone = singleZoneOf(place?.countryCode);

  // ---- Text the shared library cleans, redacts and summarises --------------
  const description = [
    event.description,
    coOrganizers.length === 0 ? undefined : `Co-organized by: ${coOrganizers.join(', ')}`,
  ]
    .filter((part): part is string => part !== undefined && part.trim().length > 0)
    .join('\r\n\r\n');
  const eligibilityText = [
    event.restrictions.trim(),
    // An online event has no venue, so its `location` is a statement about who
    // may enter ("USA only"). It is kept in their words rather than dropped.
    !event.onsite && location.length > 0 ? `Location stated by the source: ${location}` : '',
  ]
    .filter((part) => part.length > 0)
    .join('. ');

  const raw: RawCandidate = {
    sourceKey: ctx.sourceKey,
    externalKey: id,
    url: eventPageUrl(ctx.origin, id),
    title: event.title,
    sourceType: 'CTF',
    organizerName,
    description: description.length === 0 ? undefined : description,
    eligibilityText: eligibilityText.length === 0 ? undefined : eligibilityText,
    eligibility: eligibilityOf(event.restrictions),
    mode: event.onsite ? 'offline' : 'online',
    place,
    timezone: venueZone,
    startsAt: { structured: event.start },
    endsAt: { structured: event.finish },
    officialUrl: nonEmpty(event.url),
    registrationUrl: nonEmpty(event.ctftime_url),
    sourceTags:
      event.format === undefined || event.format.trim() === '' ? undefined : [event.format.trim()],
  };

  // CTFtime's timestamps carry their own offset, so they are exact instants
  // whatever zone is assumed (R85 — the library keeps their precision either
  // way). UTC is passed so the library's generic "zone assumed" warning is not
  // added on top of the CTFtime-specific one below. The *event's* zone is still
  // unknown and is recorded as such rather than claimed.
  const { candidate } = normalizeCandidate(raw, {
    clock: ctx.clock,
    sourceTimezone: venueZone === undefined ? 'UTC' : undefined,
    sourceEventType: 'CTF',
  });

  if (venueZone === undefined) {
    extra.push({
      code: 'TIMEZONE_ASSUMED',
      field: 'timezone',
      message:
        'CTFtime states no time zone and the venue gives none. The start and end carry their own UTC offset, ' +
        'so the times are exact; the event is shown in UTC.',
    });
  }
  const mismatch = durationMismatch(event, candidate);
  if (mismatch !== undefined) {
    extra.push(mismatch);
  }

  // `prizes` is free text too, and an organizer's e-mail turns up in it.
  const prizeText = redact(event.prizes);
  if (prizeText !== event.prizes) {
    extra.push({
      code: 'PII_REDACTED',
      field: 'prize',
      message: 'Contact details in the prize text were replaced (D-29).',
    });
  }
  const prize = prizeFromText(prizeText);
  const claims = prizeClaims(prizeText, event.description);

  return EventCandidate.parse({
    ...(venueZone === undefined ? withoutTimezone(candidate) : candidate),
    eventType: { value: 'CTF', confidence: 1, raw: 'CTFtime' },
    organizerKind: organizerKindOf(organizerName, ctx.geo),
    ...(prize === undefined ? {} : { prize }),
    // There is no fee field: unknown, never zero.
    fee: { known: false, confidence: 0 },
    ...(claims.length === 0 ? {} : { alternateClaims: claims }),
    warnings: [...candidate.warnings, ...extra],
  });
}

/** "Seoul, Korea" through the geocoder; the stated words survive a miss. */
function placeOf(
  location: string,
  geo: CtftimeGeo,
  warnings: ParseWarning[],
): CandidatePlace | undefined {
  const stated = parseLocation(location);
  if (stated === undefined) {
    return undefined;
  }
  const resolved = geo.resolve({
    ...(stated.city === undefined ? {} : { city: stated.city }),
    ...(stated.countryCode === undefined ? {} : { countryCode: stated.countryCode }),
  });
  warnings.push(...resolved.warnings);
  const place: CandidatePlace = {
    ...optional('city', resolved.city ?? stated.city),
    ...optional('state', resolved.state),
    ...optional('countryCode', resolved.countryCode ?? stated.countryCode),
    ...optional('lat', resolved.lat),
    ...optional('lon', resolved.lon),
    geoPrecision: resolved.geoPrecision,
  };
  return place;
}

/**
 * `restrictions` → flags (R51). "Open" says nothing restrictive, so nothing is
 * set; the unknown flags stay absent rather than becoming `true`.
 */
function eligibilityOf(restrictions: string): CandidateEligibility | undefined {
  const value = restrictions.trim();
  const flag = (answer: boolean, confidence: number): Uncertain<boolean> => ({
    value: answer,
    confidence,
    raw: value,
  });
  switch (value.toLowerCase()) {
    case 'high-school':
      // A high-school event is closed to every university student.
      return {
        undergraduate: flag(false, 0.9),
        postgraduate: flag(false, 0.9),
        doctoral: flag(false, 0.9),
      };
    case 'prequalified':
      return { qualifiedOnly: flag(true, 1) };
    default:
      return undefined;
  }
}

/** COMMUNITY unless the organizer is a seeded institution (§7.3). */
function organizerKindOf(
  organizerName: string | undefined,
  geo: CtftimeGeo,
): Uncertain<OrganizerKind> | undefined {
  if (organizerName === undefined) {
    return undefined;
  }
  const institution = geo.institutionNamed(organizerName);
  if (institution !== undefined) {
    return {
      value: ORGANIZER_KIND_BY_INSTITUTION[institution.kind],
      confidence: 0.8,
      raw: organizerName,
    };
  }
  // CTFtime organizers are teams; a team is a community, not an institution.
  return { value: 'COMMUNITY', confidence: 0.7, raw: organizerName };
}

/** `duration {days, hours}` against the timestamps it should agree with. */
function durationMismatch(
  event: CtftimeEvent,
  candidate: EventCandidate,
): ParseWarning | undefined {
  const { startsAt, endsAt } = candidate;
  if (startsAt === undefined || endsAt === undefined) {
    return undefined;
  }
  const stated = (event.duration.days * 24 + event.duration.hours) * 3_600_000;
  const actual = endsAt.at - startsAt.at;
  if (Math.abs(actual - stated) < DURATION_TOLERANCE_MS) {
    return undefined;
  }
  return {
    code: 'DATE_DURATION_MISMATCH',
    field: 'endsAt',
    message:
      `CTFtime states a duration of ${String(event.duration.days)} d ${String(event.duration.hours)} h, ` +
      `but the start and end are ${(actual / 3_600_000).toFixed(1)} h apart; the timestamps were kept.`,
  };
}

/** An assumed zone is not a fact about the event, so it is not recorded as one. */
function withoutTimezone(candidate: EventCandidate): EventCandidate {
  const copy = { ...candidate };
  delete copy.timezone;
  return copy;
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optional<V>(key: string, value: V | undefined): Record<string, V> {
  return value === undefined ? {} : { [key]: value };
}

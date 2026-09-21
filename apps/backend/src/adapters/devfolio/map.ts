import {
  EventCandidate,
  type CandidatePlace,
  type CandidatePrize,
  type InstitutionKind,
  type OrganizerKind,
  type ParseWarning,
} from '@compintel/contracts';

import { normalizeCandidate, type RawCandidate } from '../../domain/normalize/index.js';
import type { GeocodeResult } from '../../modules/geo/geocoder.js';
import type { Clock } from '../../platform/time.js';
import { parseLocation } from '../../domain/geo/location.js';
import { hackathonUrl } from './fetch.js';
import type { DevfolioDetailPage, DevfolioHackathon, DevfolioDetailHackathon } from './schema.js';

/**
 * One Devfolio hackathon → one `EventCandidate`. **Pure** (R52).
 *
 * **PII is dropped by construction (D-29).** The candidate is built from an
 * explicit allowlist of named fields. `participants_details`, `judges`,
 * `mentors`, `settings.contact_email` and every social handle except
 * `settings.site` are never read, so they cannot leave this file; prose
 * (`desc`, `tagline`, FAQ answers) goes through WP-08a's redactor.
 */

export interface DevfolioGeo {
  resolve(place: CandidatePlace | undefined): GeocodeResult;
  institutionNamed(
    name: string,
  ): { readonly name: string; readonly kind: InstitutionKind } | undefined;
}

export interface DevfolioMapContext {
  readonly clock: Clock;
  readonly sourceKey: string;
  readonly geo: DevfolioGeo;
}

export type DevfolioInput =
  | {
      readonly kind: 'listing';
      readonly hackathon: DevfolioHackathon;
      readonly unavailable?: string;
    }
  | { readonly kind: 'detail'; readonly page: DevfolioDetailPage };

/** Devfolio still sends the pre-2016 alias; the canonical IANA name is Asia/Kolkata. */
const ZONE_ALIASES: Readonly<Record<string, string>> = { 'Asia/Calcutta': 'Asia/Kolkata' };

const ORGANIZER_KIND: Readonly<Record<InstitutionKind, OrganizerKind>> = {
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

export function devfolioExternalKey(uuid: string): string {
  return `devfolio:${uuid.toLowerCase()}`;
}

export function canonicalZone(zone: string | null | undefined): string | undefined {
  const trimmed = zone?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : (ZONE_ALIASES[trimmed] ?? trimmed);
}

function modeOf(hackathon: DevfolioHackathon): string {
  if (hackathon.is_online) {
    return 'online';
  }
  return hackathon.settings?.is_hybrid === true ? 'hybrid' : 'offline';
}

function description(detail: DevfolioDetailHackathon | undefined): string | undefined {
  if (detail === undefined) {
    return undefined;
  }
  const faqs = (detail.faqs ?? [])
    .filter((faq) => (faq.question ?? '').trim() !== '' && (faq.answer ?? '').trim() !== '')
    .map((faq) => `**${(faq.question ?? '').trim()}**\n\n${(faq.answer ?? '').trim()}`);
  const parts = [
    detail.tagline?.trim(),
    detail.desc?.trim(),
    faqs.length === 0 ? undefined : `## FAQ\n\n${faqs.join('\n\n')}`,
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return parts.length === 0 ? undefined : parts.join('\n\n');
}

function prizeOf(page: DevfolioDetailPage | undefined): CandidatePrize | undefined {
  if (page === undefined) {
    return undefined;
  }
  const lines = (page.prizeDetails ?? [])
    .map((prize) => {
      const label = (prize.name ?? prize.title ?? '').trim();
      const amount = prize.amount ?? prize.value;
      const currency = prize.currency ?? page.aggregatePrizeCurrency ?? '';
      return [label, amount == null ? '' : `${String(amount)} ${currency}`.trim()]
        .filter(Boolean)
        .join(' — ');
    })
    .filter((line) => line.length > 0);
  const value = page.aggregatePrizeValue ?? 0;
  const currency = page.aggregatePrizeCurrency?.trim().toUpperCase();
  // Devfolio reports 0 when the organiser has not filled the prize table in,
  // so zero is "not stated", never "no prize".
  const total =
    value > 0 && currency !== undefined && /^[A-Z]{3}$/.test(currency)
      ? { totalMinor: Math.round(value * 100), currency }
      : undefined;
  if (lines.length === 0 && total === undefined) {
    return undefined;
  }
  return {
    ...(lines.length === 0 ? {} : { text: lines.join('\n') }),
    ...(total ?? {}),
  };
}

function placeOf(
  detail: DevfolioDetailHackathon | undefined,
  online: boolean,
  geo: DevfolioGeo,
  warnings: ParseWarning[],
): CandidatePlace | undefined {
  if (detail === undefined || online) {
    return undefined;
  }
  const stated = parseLocation([detail.city, detail.country].filter(Boolean).join(', '));
  const venueName = nonEmpty(detail.location);
  if (stated === undefined && venueName === undefined) {
    return undefined;
  }
  const resolved = geo.resolve({
    ...(stated?.city === undefined ? {} : { city: stated.city }),
    ...(stated?.countryCode === undefined ? {} : { countryCode: stated.countryCode }),
    ...(venueName === undefined ? {} : { venueName }),
  });
  warnings.push(...resolved.warnings);
  const out: Record<string, unknown> = { geoPrecision: resolved.geoPrecision };
  const put = (key: string, value: unknown): void => {
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  };
  put('venueName', venueName);
  put('city', resolved.city ?? stated?.city);
  put('state', resolved.state);
  put('countryCode', resolved.countryCode ?? stated?.countryCode);
  put('lat', resolved.lat);
  put('lon', resolved.lon);
  return out;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** `themes[].theme.name`, or absent when the page carries none (the detail page often does not). */
function tagsOf(hackathon: DevfolioHackathon): string[] | undefined {
  const tags = (hackathon.themes ?? []).map((theme) => theme.theme.name.trim()).filter(Boolean);
  return tags.length === 0 ? undefined : tags;
}

export function mapDevfolio(input: DevfolioInput, ctx: DevfolioMapContext): EventCandidate {
  const page = input.kind === 'detail' ? input.page : undefined;
  const hackathon: DevfolioHackathon =
    page?.hackathon ?? (input as { hackathon: DevfolioHackathon }).hackathon;
  const detail = page?.hackathon;
  const extra: ParseWarning[] = [];
  const zone = canonicalZone(hackathon.timezone);
  const place = placeOf(detail, hackathon.is_online, ctx.geo, extra);
  const url = hackathonUrl(hackathon.slug);
  const settings = hackathon.settings ?? undefined;

  const raw: RawCandidate = {
    sourceKey: ctx.sourceKey,
    externalKey: devfolioExternalKey(hackathon.uuid),
    url,
    title: hackathon.name,
    sourceType: hackathon.type,
    description: description(detail),
    mode: modeOf(hackathon),
    place,
    timezone: zone,
    startsAt: { structured: hackathon.starts_at },
    endsAt: { structured: hackathon.ends_at },
    registrationOpensAt:
      settings?.reg_starts_at == null ? undefined : { structured: settings.reg_starts_at },
    registrationDeadlineAt:
      settings?.reg_ends_at == null ? undefined : { structured: settings.reg_ends_at },
    officialUrl: nonEmpty(settings?.site),
    registrationUrl: url,
    sourceTags: tagsOf(hackathon),
  };
  const { candidate } = normalizeCandidate(raw, { clock: ctx.clock, sourceEventType: 'HACKATHON' });

  if (input.kind === 'listing' && input.unavailable !== undefined) {
    extra.push({ code: 'DETAIL_UNAVAILABLE', field: 'url', message: input.unavailable });
  }

  // Organizer: not a Devfolio field. Only a seeded institution named in the
  // venue is taken, and at low confidence; otherwise it stays unknown.
  const institution = detail?.location ? ctx.geo.institutionNamed(detail.location) : undefined;
  const paid = settings?.paid;
  const teamMin = detail?.team_min ?? undefined;
  const teamMax = detail?.team_max ?? undefined;
  const team =
    teamMin === undefined && teamMax === undefined
      ? undefined
      : teamMin !== undefined && teamMax !== undefined && teamMin > teamMax
        ? undefined
        : {
            ...(teamMin === undefined ? {} : { min: teamMin }),
            ...(teamMax === undefined ? {} : { max: teamMax }),
            confidence: 1,
          };
  const prize = prizeOf(page);

  return EventCandidate.parse({
    ...candidate,
    ...(institution === undefined
      ? {}
      : {
          organizerName: institution.name,
          organizerKind: {
            value: ORGANIZER_KIND[institution.kind],
            confidence: 0.5,
            raw: detail?.location ?? institution.name,
          },
        }),
    fee:
      paid === false
        ? {
            known: true,
            minor: 0,
            currency: 'INR',
            text: 'No registration fee (Devfolio)',
            confidence: 0.9,
          }
        : paid === true
          ? { known: false, text: 'Paid — the amount is not stated on Devfolio', confidence: 0 }
          : { known: false, confidence: 0 },
    ...(team === undefined ? {} : { teamSize: team }),
    ...(prize === undefined ? {} : { prize }),
    warnings: [...candidate.warnings, ...extra],
  });
}

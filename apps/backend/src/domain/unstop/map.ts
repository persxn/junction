import {
  EventCandidate,
  type CandidatePlace,
  type CandidatePrize,
  type ParseWarning,
} from '@compintel/contracts';

import type { Clock } from '../../platform/time.js';
import { parseLocation } from '../geo/location.js';
import { normalizeCandidate } from '../normalize/index.js';
import type { UnstopDetail, UnstopOpportunity } from './schema.js';

/**
 * One Unstop opportunity → one `EventCandidate`. **Pure** (R52), built on
 * WP-08a's normalization library — no date, fee or team-size parsing of its own.
 *
 * An explicit allowlist: organiser contacts, registered users and every other
 * people-shaped key Unstop sends are never named here, so they cannot reach the
 * candidate (D-29); the description goes through the sanitizer and redactor.
 *
 * **Type filter (D-31).** Unstop lists quizzes, case studies, cultural events,
 * workshops and job fairs beside competitions. Those map to `OTHER` with high
 * confidence, and WP-08b's event-type policy stores them POLICY_HIDDEN — never
 * dropped, so widening the policy needs no re-scrape.
 */

export interface UnstopMapContext {
  readonly clock: Clock;
  readonly sourceKey: string;
  /** Unstop is an Indian platform and its times carry +05:30. */
  readonly defaultTimeZone: string;
}

export type UnstopInput =
  | { readonly kind: 'listing'; readonly item: UnstopOpportunity; readonly fromPage?: boolean }
  | { readonly kind: 'detail'; readonly competition: UnstopDetail['data']['competition'] };

export const UNSTOP_ORIGIN = 'https://unstop.com';

/** Unstop's own subtypes that are competitions in D-31's sense, by what they map to. */
const TECH_SUBTYPES: Readonly<Record<string, string>> = {
  hackathon: 'hackathon',
  hackathons: 'hackathon',
  coding: 'coding contest',
  coding_challenge: 'coding contest',
  programming: 'coding contest',
  ideathon: 'ideathon',
  idea: 'ideathon',
  innovation_challenge: 'innovation challenge',
  ctf: 'ctf',
};

/** Subtypes that are out of the MVP's scope (D-31) — stored hidden, never dropped. */
const NON_TECH_SUBTYPES: ReadonlySet<string> = new Set([
  'quiz',
  'quizzes',
  'case_study',
  'case_competition',
  'cultural',
  'workshop',
  'workshops',
  'conference',
  'job_fair',
  'marketing',
  'business',
  'debate',
  'essay',
  'others',
]);

const CURRENCIES: Readonly<Record<string, string>> = {
  'fa-rupee': 'INR',
  inr: 'INR',
  '₹': 'INR',
  'fa-dollar': 'USD',
  usd: 'USD',
  $: 'USD',
};

export function unstopExternalKey(id: number): string {
  return `unstop:${String(id)}`;
}

/** The public page, from the payload's relative path — only under the two allowed sections. */
export function publicUrlOf(item: UnstopOpportunity): string {
  const path = item.public_url.replace(/^\/+/, '');
  if (!/^(?:hackathons|competitions)\/[a-z0-9-]+$/i.test(path)) {
    const section = item.type.toLowerCase().startsWith('hackathon') ? 'hackathons' : 'competitions';
    return `${UNSTOP_ORIGIN}/${section}/${String(item.id)}`;
  }
  return `${UNSTOP_ORIGIN}/${path}`;
}

function sourceTypeOf(item: UnstopOpportunity): string | undefined {
  const subtype = item.subtype?.trim().toLowerCase();
  if (subtype !== undefined && TECH_SUBTYPES[subtype] !== undefined) {
    return TECH_SUBTYPES[subtype];
  }
  return item.type.toLowerCase().startsWith('hackathon') ? 'hackathon' : undefined;
}

function modeOf(item: UnstopOpportunity): string | undefined {
  const region = item.region?.trim().toLowerCase();
  return region === 'online' || region === 'offline' || region === 'hybrid' ? region : undefined;
}

function placeOf(item: UnstopOpportunity): CandidatePlace | undefined {
  if (item.region?.trim().toLowerCase() === 'online') {
    return undefined;
  }
  const address = item.address_with_country_logo;
  const city = address?.city?.trim();
  const state = address?.state?.trim();
  const countryCode = parseLocation(address?.country?.name ?? '')?.countryCode;
  if (!city && !state && countryCode === undefined) {
    return undefined;
  }
  return {
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(countryCode === undefined ? {} : { countryCode }),
  };
}

function prizeOf(item: UnstopOpportunity): CandidatePrize | undefined {
  const lines: string[] = [];
  const cash: { minor: number; currency: string }[] = [];
  for (const prize of item.prizes ?? []) {
    const currency = CURRENCIES[(prize.currency ?? '').trim().toLowerCase()];
    const rank =
      prize.rank === null || prize.rank === undefined ? '' : `Rank ${String(prize.rank)}: `;
    const amount =
      prize.cash === null || prize.cash === undefined
        ? ''
        : `${currency === 'INR' ? '₹' : currency === 'USD' ? '$' : ''}${prize.cash.toLocaleString('en-IN')}`;
    const other = prize.others?.trim() ?? '';
    const line = `${rank}${[amount, other].filter(Boolean).join(' + ')}`.trim();
    if (line.length > 0) {
      lines.push(line);
    }
    if (prize.cash !== null && prize.cash !== undefined && currency !== undefined) {
      cash.push({ minor: Math.round(prize.cash * 100), currency });
    }
  }
  if (lines.length === 0) {
    return undefined;
  }
  // One stated cash prize is a total; a table is text — adding placings up
  // would invent a number nobody stated (WP-08a).
  const only = cash.length === 1 && (item.prizes ?? []).length === 1 ? cash[0] : undefined;
  return {
    text: lines.join('\n'),
    ...(only === undefined ? {} : { totalMinor: only.minor, currency: only.currency }),
  };
}

export function mapUnstop(input: UnstopInput, ctx: UnstopMapContext): EventCandidate {
  const item: UnstopOpportunity = input.kind === 'detail' ? input.competition : input.item;
  const details = input.kind === 'detail' ? (input.competition.details ?? undefined) : undefined;
  const extra: ParseWarning[] = [];
  const url = publicUrlOf(item);
  const registration = item.regnRequirements ?? undefined;
  const tags = (item.filters ?? []).map((filter) => filter.name.trim()).filter(Boolean);

  const { candidate } = normalizeCandidate(
    {
      sourceKey: ctx.sourceKey,
      externalKey: unstopExternalKey(item.id),
      url,
      title: item.title,
      sourceType: sourceTypeOf(item),
      organizerName: item.organisation?.name,
      description: details ?? undefined,
      mode: modeOf(item),
      place: placeOf(item),
      startsAt: item.start_date == null ? undefined : { structured: item.start_date },
      endsAt: item.end_date == null ? undefined : { structured: item.end_date },
      registrationOpensAt:
        registration?.start_regn_dt == null
          ? undefined
          : { structured: registration.start_regn_dt },
      registrationDeadlineAt:
        registration?.end_regn_dt == null ? undefined : { structured: registration.end_regn_dt },
      registrationUrl: url,
      sourceTags: tags.length === 0 ? undefined : tags,
    },
    { clock: ctx.clock, sourceTimezone: ctx.defaultTimeZone },
  );

  if (input.kind === 'listing' && input.fromPage === true) {
    extra.push({
      code: 'DETAIL_UNAVAILABLE',
      field: 'url',
      message:
        "Read from the page's embedded state because the /api/public listing did not answer as expected.",
    });
  }

  const subtype = item.subtype?.trim().toLowerCase();
  const nonTech = subtype !== undefined && NON_TECH_SUBTYPES.has(subtype);
  const min = registration?.min_team_size ?? undefined;
  const max = registration?.max_team_size ?? undefined;
  const team =
    (min === undefined && max === undefined) ||
    (min !== undefined && max !== undefined && min > max)
      ? undefined
      : {
          ...(min === undefined ? {} : { min }),
          ...(max === undefined ? {} : { max }),
          text:
            min === undefined
              ? `up to ${String(max)}`
              : max === undefined || max === min
                ? String(min)
                : `${String(min)}–${String(max)}`,
          confidence: 1,
        };
  const prize = prizeOf(item);

  return EventCandidate.parse({
    ...candidate,
    ...(nonTech ? { eventType: { value: 'OTHER', confidence: 0.95, raw: subtype } } : {}),
    fee:
      item.isPaid === false
        ? { known: true, minor: 0, currency: 'INR', text: 'Free (Unstop)', confidence: 0.9 }
        : item.isPaid === true
          ? { known: false, text: 'Paid — the amount is on the Unstop page', confidence: 0 }
          : { known: false, confidence: 0 },
    ...(team === undefined ? {} : { teamSize: team }),
    ...(prize === undefined ? {} : { prize }),
    warnings: [...candidate.warnings, ...extra],
  });
}

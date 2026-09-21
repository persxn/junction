import type {
  CandidateDeadline,
  CandidatePlace,
  EventCandidate,
  ImportField,
  ManualEventInput,
  OverrideField,
} from '@compintel/contracts';

import type { Clock } from '../../platform/time.js';
import { APP_TIMEZONE } from '../../platform/time.js';
import { parseDate } from '../normalize/dates.js';
import { redact } from '../normalize/redact.js';
import type { RawCandidate } from '../normalize/index.js';
import { FOUND_FIELDS, FOUND_LABELS, type FoundEvent, type FoundField } from './found.js';

/**
 * What a page said, and what a professor typed, turned into the one shape
 * WP-08a normalizes (WP-14).
 *
 * Both paths end in `RawCandidate` on purpose: a manually entered event gets the
 * same date parsing, the same sanitizer, the same redactor (D-29) and the same
 * warnings as a scraped one. A form that wrote straight to the database would be
 * a second normalization path to keep in step with the first, and the one that
 * gets forgotten is always the one a person uses twice a year.
 */

/** The URL a manual event with no link of its own is recorded under. */
export const MANUAL_URL_PREFIX = 'https://manual.compintel.invalid/';

/** A stable, reserved URL for a manual entry (RFC 2606: `.invalid` never resolves). */
export function manualRecordUrl(externalKey: string): string {
  return `${MANUAL_URL_PREFIX}${encodeURIComponent(externalKey)}`;
}

function placeText(place: CandidatePlace): string {
  return [place.venueName, place.city, place.state, place.countryCode]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(', ');
}

/** The display value the review step shows for one found field. */
function displayOf(field: FoundField, value: unknown): string | undefined {
  if (field === 'place') {
    const text = placeText(value as CandidatePlace);
    return text.length === 0 ? undefined : text;
  }
  return typeof value === 'string' ? value : String(value);
}

/**
 * What the preview lists: every field that was found, and the labels of the
 * fields that were not.
 *
 * Both halves are the answer. §16.3 asks an empty state to say what is missing,
 * and a preview that shows four values without mentioning the absent deadline
 * invites the professor to believe there is no deadline.
 */
export function importFields(found: FoundEvent): {
  fieldsFound: ImportField[];
  fieldsMissing: string[];
} {
  const fieldsFound: ImportField[] = [];
  const fieldsMissing: string[] = [];
  for (const field of FOUND_FIELDS) {
    const entry = found[field];
    const value = entry === undefined ? undefined : displayOf(field, entry.value);
    if (entry === undefined || value === undefined) {
      fieldsMissing.push(FOUND_LABELS[field]);
      continue;
    }
    // D-29 applies to the preview too. What the professor sees is what they
    // will save, and a contact address that reached the screen would be copied
    // back in the commit — so it is removed here, not only at ingest.
    fieldsFound.push({
      field,
      label: FOUND_LABELS[field],
      value: redact(value).slice(0, 500),
      confidence: entry.confidence,
      origin: entry.origin,
      ...(entry.raw === undefined ? {} : { raw: redact(entry.raw).slice(0, 500) }),
    });
  }
  return { fieldsFound, fieldsMissing };
}

export interface RecordIdentity {
  readonly sourceKey: string;
  readonly externalKey: string;
  readonly url: string;
}

/**
 * A generic page read → `RawCandidate`.
 *
 * Dates stay as *text*: the extractor found "30 Sep 2026" next to the words
 * "Registration closes", and deciding what instant that is — in which zone, at
 * which precision, with which warning — is WP-08a's job and nobody else's.
 */
export function rawFromFound(identity: RecordIdentity, found: FoundEvent): RawCandidate {
  const text = (field: FoundField): string | undefined => {
    const value = found[field]?.value;
    return typeof value === 'string' ? value : undefined;
  };
  return {
    sourceKey: identity.sourceKey,
    externalKey: identity.externalKey,
    url: identity.url,
    title: text('title') ?? '',
    ...(text('organizerName') === undefined ? {} : { organizerName: text('organizerName') }),
    ...(text('description') === undefined ? {} : { description: text('description') }),
    ...(text('prizeText') === undefined ? {} : { prizeText: text('prizeText') }),
    ...(found.mode === undefined ? {} : { mode: found.mode.value }),
    ...(found.place === undefined ? {} : { place: found.place.value }),
    ...(found.startsAt === undefined ? {} : { startsAt: { text: found.startsAt.value } }),
    ...(found.endsAt === undefined ? {} : { endsAt: { text: found.endsAt.value } }),
    ...(found.registrationDeadlineAt === undefined
      ? {}
      : { registrationDeadlineAt: { text: found.registrationDeadlineAt.value } }),
    ...(text('teamSizeText') === undefined ? {} : { teamSizeText: text('teamSizeText') }),
    ...(text('feeText') === undefined ? {} : { feeText: text('feeText') }),
    ...(text('officialUrl') === undefined ? {} : { officialUrl: text('officialUrl') }),
    ...(text('registrationUrl') === undefined ? {} : { registrationUrl: text('registrationUrl') }),
  };
}

/** The extra deadlines a form states, as instants in the event's own zone. */
function manualDeadlines(
  fields: ManualEventInput,
  clock: Clock,
  timezone: string,
): CandidateDeadline[] {
  return (fields.deadlines ?? []).flatMap((deadline) => {
    const parsed = parseDate(
      { structured: deadline.at },
      {
        timezone,
        clock,
        field: 'deadlines',
        dateOnlyMeans: 'END_OF_DAY',
        lowerPrecision: false,
      },
    );
    return parsed === undefined
      ? []
      : [
          {
            kind: deadline.kind,
            label: deadline.label,
            dueAt: parsed.at,
            precision: deadline.precision ?? parsed.precision,
            raw: deadline.at,
          },
        ];
  });
}

/**
 * A professor's own entry → `RawCandidate`.
 *
 * The event type is not put here: an explicit choice is passed to
 * `normalizeCandidate` as the context's `sourceEventType`, which is how a
 * single-purpose source states a type it is certain of. A professor picking
 * "Hackathon" from a list is exactly that kind of certainty.
 */
export function rawFromManual(
  identity: RecordIdentity,
  fields: ManualEventInput,
  clock: Clock,
): RawCandidate {
  const timezone = fields.timezone ?? APP_TIMEZONE;
  const deadlines = manualDeadlines(fields, clock, timezone);
  const date = (value: { at: string } | undefined): { structured: string } | undefined =>
    value === undefined ? undefined : { structured: value.at };
  return {
    sourceKey: identity.sourceKey,
    externalKey: identity.externalKey,
    url: identity.url,
    title: fields.title,
    ...(fields.organizerName === undefined ? {} : { organizerName: fields.organizerName }),
    ...(fields.description === undefined ? {} : { description: fields.description }),
    ...(fields.eligibilityText === undefined ? {} : { eligibilityText: fields.eligibilityText }),
    ...(fields.requirementsText === undefined ? {} : { requirementsText: fields.requirementsText }),
    ...(fields.submissionRequirementsText === undefined
      ? {}
      : { submissionRequirementsText: fields.submissionRequirementsText }),
    ...(fields.prizeText === undefined ? {} : { prizeText: fields.prizeText }),
    ...(fields.mode === undefined ? {} : { mode: fields.mode }),
    ...(fields.place === undefined ? {} : { place: fields.place }),
    ...(fields.timezone === undefined ? {} : { timezone: fields.timezone }),
    ...(date(fields.registrationOpensAt) === undefined
      ? {}
      : { registrationOpensAt: date(fields.registrationOpensAt) }),
    ...(date(fields.registrationDeadlineAt) === undefined
      ? {}
      : { registrationDeadlineAt: date(fields.registrationDeadlineAt) }),
    ...(date(fields.startsAt) === undefined ? {} : { startsAt: date(fields.startsAt) }),
    ...(date(fields.endsAt) === undefined ? {} : { endsAt: date(fields.endsAt) }),
    ...(date(fields.submissionDeadlineAt) === undefined
      ? {}
      : { submissionDeadlineAt: date(fields.submissionDeadlineAt) }),
    ...(date(fields.resultAt) === undefined ? {} : { resultAt: date(fields.resultAt) }),
    ...(deadlines.length === 0 ? {} : { deadlines }),
    ...(fields.teamSizeText === undefined ? {} : { teamSizeText: fields.teamSizeText }),
    ...(fields.feeText === undefined ? {} : { feeText: fields.feeText }),
    ...(fields.officialUrl === undefined ? {} : { officialUrl: fields.officialUrl }),
    ...(fields.registrationUrl === undefined ? {} : { registrationUrl: fields.registrationUrl }),
  };
}

/**
 * An adapter's candidate, described the way a page read is — so the review step
 * shows one list whichever path the link took.
 *
 * The origin is `ADAPTER` and the confidences are the candidate's own: a source
 * that stated a start time in a structured field says so with 1, and the same
 * field read out of prose says so with less. A professor comparing two imports
 * is then comparing the same scale.
 */
export function foundFromCandidate(candidate: EventCandidate): FoundEvent {
  const out: Record<string, unknown> = {};
  const put = (field: FoundField, value: unknown, confidence: number, raw?: string): void => {
    if (value !== undefined && value !== null && value !== '') {
      out[field] = { value, origin: 'ADAPTER', confidence, ...(raw === undefined ? {} : { raw }) };
    }
  };
  put('title', candidate.title, 1);
  put('description', candidate.summary ?? candidate.descriptionMd, 1);
  put('organizerName', candidate.organizerName, candidate.organizerKind?.confidence ?? 1);
  put(
    'startsAt',
    candidate.startsAt?.raw ?? isoOf(candidate.startsAt?.at),
    candidate.startsAt?.confidence ?? 1,
  );
  put(
    'endsAt',
    candidate.endsAt?.raw ?? isoOf(candidate.endsAt?.at),
    candidate.endsAt?.confidence ?? 1,
  );
  put(
    'registrationDeadlineAt',
    candidate.registrationDeadlineAt?.raw ?? isoOf(candidate.registrationDeadlineAt?.at),
    candidate.registrationDeadlineAt?.confidence ?? 1,
  );
  put(
    'mode',
    candidate.mode.value === 'UNKNOWN' ? undefined : candidate.mode.value,
    candidate.mode.confidence,
  );
  put('place', candidate.place, 1);
  put('feeText', candidate.fee?.text, candidate.fee?.confidence ?? 1);
  put('prizeText', candidate.prize?.text, 1);
  put('teamSizeText', candidate.teamSize?.text, candidate.teamSize?.confidence ?? 1);
  put('officialUrl', candidate.officialUrl, 1);
  put('registrationUrl', candidate.registrationUrl, 1);
  return out;
}

function isoOf(at: number | undefined): string | undefined {
  return at === undefined ? undefined : new Date(at).toISOString();
}

/**
 * Which `event_overrides` fields a form entry stands behind (§7.5, WP-14).
 *
 * A box the professor filled in is a value they are stating, and it beats
 * whatever a source says later. A box they left empty is not: it means "I did
 * not say", so nothing is written and a source may still fill it.
 *
 * One typed box can stand behind several stored fields — "₹500 per team" is a
 * known fee, an amount and a currency — because those are one fact, and an
 * override on the text without one on the amount would leave the event showing
 * a scraped price under the professor's wording.
 */
export function statedFields(fields: ManualEventInput): OverrideField[] {
  const stated: OverrideField[] = [];
  const put = (value: unknown, ...names: OverrideField[]): void => {
    if (value !== undefined) {
      stated.push(...names);
    }
  };
  put(fields.title, 'title');
  put(fields.eventType, 'eventType');
  put(fields.organizerName, 'organizerName');
  put(fields.description, 'descriptionMd', 'summary');
  put(fields.eligibilityText, 'eligibilityText');
  put(fields.requirementsText, 'requirementsText');
  put(fields.submissionRequirementsText, 'submissionRequirementsText');
  put(fields.prizeText, 'prizeText', 'prizeTotalMinor', 'prizeCurrency');
  put(fields.mode, 'mode');
  put(fields.place?.venueName, 'venueName');
  put(fields.place?.city, 'city');
  put(fields.place?.state, 'state');
  put(fields.place?.countryCode, 'countryCode');
  put(fields.timezone, 'timezone');
  put(fields.registrationOpensAt, 'registrationOpensAt');
  put(fields.registrationDeadlineAt, 'registrationDeadlineAt');
  put(fields.startsAt, 'startsAt');
  put(fields.endsAt, 'endsAt');
  put(fields.submissionDeadlineAt, 'submissionDeadlineAt');
  put(fields.teamSizeText, 'teamMin', 'teamMax');
  put(fields.feeText, 'feeKnown', 'feeMinor', 'feeCurrency', 'feeText');
  put(fields.officialUrl, 'officialUrl');
  put(fields.registrationUrl, 'registrationUrl');
  return stated;
}

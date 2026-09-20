import {
  EventCandidate,
  type CandidateDate,
  type CandidateDeadline,
  type CandidateEligibility,
  type CandidatePlace,
  type CandidatePrize,
  type EventType,
  type ParseWarning,
} from '@compintel/contracts';

import type { Clock } from '../../platform/time.js';
import {
  combinedPrecision,
  parseDate,
  resolveTimezone,
  validateRange,
  type StructuredDate,
} from './dates.js';
import { resolveEditionYear } from './edition-year.js';
import { parseEventType } from './event-type.js';
import { parseFee, parsePrizeTotal } from './fees.js';
import { parseMode } from './mode.js';
import { detectRecurring } from './recurring.js';
import { redact } from './redact.js';
import { parseTeamSize } from './team-size.js';
import { cleanTitle, toMarkdown, toSummary } from './text.js';
import { normalizeUrl } from './urls.js';
import { WarningCollector } from './warnings.js';

export * from './dates.js';
export * from './edition-year.js';
export * from './event-type.js';
export * from './fees.js';
export * from './mode.js';
export * from './recurring.js';
export * from './redact.js';
export * from './team-size.js';
export * from './text.js';
export * from './urls.js';
export * from './warnings.js';

/**
 * The normalization library (§7.3, rulings R51 and R52).
 *
 * An adapter's `normalize()` calls into this with whatever shape its source
 * speaks, and gets back a validated `EventCandidate`. Everything under this
 * directory is pure: no network, no database, no filesystem, no `Date.now()`.
 * The clock is injected, so a fixture that says "closes next Friday" resolves to
 * the same instant in 2030 as it does today, and the boundary rules in
 * `eslint.config.js` stop that from quietly regressing.
 *
 * The discipline, stated once: **nothing is guessed.** A field that cannot be
 * resolved is absent and a warning explains why. That is why the shape has so
 * many optional fields and so few defaults — a default is a guess with better
 * manners.
 */

/** The loose, source-shaped input an adapter assembles before calling in. */
export interface RawCandidate {
  readonly sourceKey: string;
  readonly externalKey: string;
  readonly url: string;

  readonly title: string;
  /** The source's own category string, if it has one. */
  readonly sourceType?: string | undefined;
  readonly organizerName?: string | undefined;

  /** HTML or Markdown; sanitized and converted here. */
  readonly description?: string | undefined;
  readonly eligibilityText?: string | undefined;
  readonly eligibility?: CandidateEligibility | undefined;
  readonly requirementsText?: string | undefined;
  readonly submissionRequirementsText?: string | undefined;
  readonly prizeText?: string | undefined;

  /** The source's own mode field, if it has one. */
  readonly mode?: string | undefined;
  readonly place?: CandidatePlace | undefined;
  /** Whatever the source called the timezone; validated here. */
  readonly timezone?: string | undefined;

  readonly registrationOpensAt?: DateInput | undefined;
  readonly registrationDeadlineAt?: DateInput | undefined;
  readonly startsAt?: DateInput | undefined;
  readonly endsAt?: DateInput | undefined;
  readonly submissionDeadlineAt?: DateInput | undefined;
  readonly resultAt?: DateInput | undefined;
  readonly deadlines?: readonly CandidateDeadline[] | undefined;

  readonly teamSizeText?: string | undefined;
  readonly feeText?: string | undefined;

  readonly officialUrl?: string | undefined;
  readonly registrationUrl?: string | undefined;

  readonly sourceTags?: readonly string[] | undefined;
}

/** A date as a source offered it: structured, as prose, or both. */
export interface DateInput {
  /** An epoch (seconds or milliseconds) or an ISO 8601 string. */
  readonly structured?: StructuredDate | undefined;
  /** Free text, read by chrono-node only if `structured` did not work. */
  readonly text?: string | undefined;
}

/** What an adapter knows that the record itself does not say. */
export interface NormalizeContext {
  readonly clock: Clock;
  /** The IANA zone to assume when the record states none (§7.3). */
  readonly sourceTimezone?: string | undefined;
  /** For a single-purpose source: CTFtime is always CTF. */
  readonly sourceEventType?: EventType | undefined;
}

export interface NormalizeResult {
  readonly candidate: EventCandidate;
  readonly warnings: readonly ParseWarning[];
}

/**
 * Turns one source record into a validated `EventCandidate`.
 *
 * Throws if the result does not satisfy the contract — which, given `.strict()`,
 * is how R50 is enforced: an adapter that grew a `contactEmail` finds out here,
 * loudly, rather than by having it silently dropped.
 */
export function normalizeCandidate(raw: RawCandidate, ctx: NormalizeContext): NormalizeResult {
  const warnings = new WarningCollector();

  // ---- Timezone first: every date below depends on it (§7.3) ---------------
  // A record with no dates at all needs no zone, and warning that UTC was
  // assumed for dates that do not exist is noise a professor would have to
  // learn to ignore — which is how real warnings stop being read.
  const hasAnyDate =
    raw.registrationOpensAt !== undefined ||
    raw.registrationDeadlineAt !== undefined ||
    raw.startsAt !== undefined ||
    raw.endsAt !== undefined ||
    raw.submissionDeadlineAt !== undefined ||
    raw.resultAt !== undefined;
  const zone = resolveTimezone(
    {
      stated: raw.timezone,
      countryCode: raw.place?.countryCode,
      sourceDefault: ctx.sourceTimezone,
    },
    hasAnyDate ? warnings : undefined,
  );

  const dateOptions = (field: string, dateOnlyMeans: 'END_OF_DAY' | 'START_OF_DAY') => ({
    timezone: zone.timezone,
    clock: ctx.clock,
    field,
    dateOnlyMeans,
    warnings,
    lowerPrecision: zone.lowerPrecision,
  });

  const read = (
    input: DateInput | undefined,
    field: string,
    dateOnlyMeans: 'END_OF_DAY' | 'START_OF_DAY',
  ): CandidateDate | undefined =>
    input === undefined ? undefined : parseDate(input, dateOptions(field, dateOnlyMeans));

  // A deadline is the *end* of a date-only day; a start is the beginning of one.
  const registrationOpensAt = read(raw.registrationOpensAt, 'registrationOpensAt', 'START_OF_DAY');
  const registrationDeadlineAt = read(
    raw.registrationDeadlineAt,
    'registrationDeadlineAt',
    'END_OF_DAY',
  );
  const submissionDeadlineAt = read(raw.submissionDeadlineAt, 'submissionDeadlineAt', 'END_OF_DAY');
  const resultAt = read(raw.resultAt, 'resultAt', 'START_OF_DAY');
  const range = validateRange(
    {
      startsAt: read(raw.startsAt, 'startsAt', 'START_OF_DAY'),
      endsAt: read(raw.endsAt, 'endsAt', 'END_OF_DAY'),
    },
    warnings,
  );

  // ---- Text ----------------------------------------------------------------
  const title = cleanTitle(raw.title);
  const descriptionMd =
    raw.description === undefined ? undefined : toMarkdown(raw.description, warnings);
  const summary = raw.description === undefined ? undefined : toSummary(raw.description, warnings);

  // ---- The rest ------------------------------------------------------------
  const hasVenue =
    raw.place?.venueName !== undefined ||
    raw.place?.city !== undefined ||
    raw.place?.lat !== undefined;
  const searchText = [title, raw.sourceType, descriptionMd, ...(raw.sourceTags ?? [])]
    .filter((part): part is string => part !== undefined)
    .join(' ');

  const mode = parseMode(
    { stated: raw.mode, text: [searchText, raw.place?.venueName].join(' '), hasVenue },
    warnings,
  );
  const eventType = parseEventType(
    {
      sourceType: raw.sourceType,
      text: searchText,
      sourceDefault: ctx.sourceEventType,
    },
    warnings,
  );
  const recurring = detectRecurring(title);
  const fee = parseFee(raw.feeText, warnings);
  const teamSize = parseTeamSize(raw.teamSizeText, warnings);
  const prize = buildPrize(raw.prizeText);
  const editionYear = resolveEditionYear(
    {
      startsAt: range.startsAt,
      registrationDeadlineAt,
      title,
      timezone: zone.timezone,
    },
    warnings,
  );

  const candidate: EventCandidate = EventCandidate.parse({
    sourceKey: raw.sourceKey,
    externalKey: raw.externalKey,
    url: normalizeUrl(raw.url, warnings, 'url') ?? raw.url,

    title,
    titleRaw: raw.title,
    eventType,
    ...optional('organizerName', raw.organizerName?.trim()),

    ...optional('summary', summary),
    ...optional('descriptionMd', descriptionMd),
    ...optional('prize', prize),
    ...optional(
      'eligibilityText',
      raw.eligibilityText === undefined
        ? undefined
        : redact(raw.eligibilityText, warnings, 'eligibilityText'),
    ),
    ...optional('eligibility', raw.eligibility),
    ...optional(
      'requirementsText',
      raw.requirementsText === undefined
        ? undefined
        : redact(raw.requirementsText, warnings, 'requirementsText'),
    ),
    ...optional(
      'submissionRequirementsText',
      raw.submissionRequirementsText === undefined
        ? undefined
        : redact(raw.submissionRequirementsText, warnings, 'submissionRequirementsText'),
    ),

    mode,
    ...optional('place', raw.place),
    // Only recorded when it was actually resolved; an assumed UTC is not a fact.
    ...optional('timezone', zone.from === 'ASSUMED_UTC' ? undefined : zone.timezone),

    ...optional('registrationOpensAt', registrationOpensAt),
    ...optional('registrationDeadlineAt', registrationDeadlineAt),
    ...optional('startsAt', range.startsAt),
    ...optional('endsAt', range.endsAt),
    ...optional('submissionDeadlineAt', submissionDeadlineAt),
    ...optional('resultAt', resultAt),
    ...optional('deadlines', raw.deadlines === undefined ? undefined : [...raw.deadlines]),

    ...optional('teamSize', teamSize),
    ...optional('fee', fee),

    ...optional('officialUrl', maybeUrl(raw.officialUrl, warnings, 'officialUrl')),
    ...optional('registrationUrl', maybeUrl(raw.registrationUrl, warnings, 'registrationUrl')),

    ...optional('editionYear', editionYear),
    isRecurringRound: recurring.isRecurringRound,
    ...optional('seriesHint', recurring.seriesHint),

    ...optional('sourceTags', raw.sourceTags === undefined ? undefined : [...raw.sourceTags]),
    warnings: warnings.all(),
  });

  return { candidate, warnings: candidate.warnings };
}

/**
 * `{ key: value }` when the value exists, `{}` when it does not (R51).
 *
 * Spread into the object literal, this is what makes "absent" different from
 * "present and undefined" — which matters, because `.strict()` plus
 * `exactOptionalPropertyTypes` treats the two differently and only one of them
 * means "the source did not say".
 */
function optional<V>(key: string, value: V | undefined): Record<string, V> {
  return value === undefined ? {} : { [key]: value };
}

function maybeUrl(
  raw: string | undefined,
  warnings: WarningCollector,
  field: string,
): string | undefined {
  return raw === undefined ? undefined : normalizeUrl(raw, warnings, field);
}

function buildPrize(prizeText: string | undefined): CandidatePrize | undefined {
  if (prizeText === undefined || prizeText.trim().length === 0) {
    return undefined;
  }
  const total = parsePrizeTotal(prizeText);
  return {
    text: prizeText.trim(),
    ...(total === undefined ? {} : { totalMinor: total.totalMinor, currency: total.currency }),
  };
}

/** The `date_precision` to store for the start/end pair (§6.2). */
export function datePrecisionFor(candidate: EventCandidate): ReturnType<typeof combinedPrecision> {
  return combinedPrecision({ startsAt: candidate.startsAt, endsAt: candidate.endsAt });
}

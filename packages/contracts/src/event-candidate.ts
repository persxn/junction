import { z } from 'zod';

import { DatePrecision, EventMode, EventType } from './enums.js';
import {
  CountryCode,
  CurrencyCode,
  DeadlineKind,
  GeoPrecision,
  OrganizerKind,
  OverrideField,
  Recurrence,
} from './events.js';

/**
 * `EventCandidate` — the one internal shape every adapter produces (§7.1).
 *
 * An adapter's job ends here: it turns whatever a source said into this, purely,
 * and nothing downstream ever sees the source's own JSON again. That is what
 * makes a new source one file plus fixtures, and it is what lets normalization
 * be tested exhaustively without a network.
 *
 * Three rules shape it.
 *
 * **It carries no people (R50, D-29).** Not "people are filtered out" — there is
 * nowhere to put them. The object is `.strict()`, so an adapter that hands over
 * `contactEmail`, `participants`, `judges`, `mentors` or `phone` fails
 * validation loudly instead of having its extra keys silently dropped. Redaction
 * (§7.3) still runs over free text, because a description can mention an
 * organizer's e-mail; that is a different problem from a schema that invites one.
 *
 * **Uncertain fields say so (R51).** Dates, fees, team sizes, modes and event
 * types are guesses made from prose more often than not. Each is wrapped by
 * {@link uncertain}, which carries a confidence and the text it was read from,
 * so the UI can show "27 Sep (time not stated)" and a professor can check the
 * original. A field that could not be parsed is **absent** — never a zero, never
 * a default, never a low-confidence guess.
 *
 * **Everything it states is as the source stated it.** No geocoding, no
 * institution matching, no currency conversion, no policy. Those are WP-08b and
 * WP-10, and they need the unresolved value to do their job.
 */

/**
 * Wraps a value with how sure we are of it and the text it came from (R51).
 *
 * `confidence` is a blunt instrument on purpose: 1 means the source stated it in
 * a structured field, ~0.8 a reliable pattern, ~0.5 a keyword guess. The number
 * is not a probability and nothing does arithmetic on it; it exists so that a
 * conflict between two sources can be resolved (WP-10) and so that the UI knows
 * when to hedge.
 */
export function uncertain<T extends z.ZodType>(
  schema: T,
): z.ZodObject<{ value: T; confidence: z.ZodNumber; raw: z.ZodOptional<z.ZodString> }> {
  return z
    .object({
      value: schema,
      confidence: z.number().min(0).max(1),
      /** The source text this was read from, for the provenance drawer (WP-16b). */
      raw: z.string().optional(),
    })
    .strict();
}

/** The runtime shape {@link uncertain} produces. */
export interface Uncertain<T> {
  readonly value: T;
  readonly confidence: number;
  readonly raw?: string;
}

/**
 * Why a field is missing, lowered or disagreed with (§7.3).
 *
 * Closed, because these are rendered to a professor who has to decide whether to
 * trust a row, and "something went wrong parsing" is not a thing anyone can act
 * on. Each code names what was dropped and implies what to look at.
 */
export const PARSE_WARNING_CODES = [
  /** `ends_at` was before `starts_at`; both dropped rather than reordered. */
  'DATE_RANGE_INVALID',
  /** A year outside now−1 … now+5; the field was dropped, never corrected. */
  'DATE_OUT_OF_RANGE',
  /** Text that looked like a date but no parser agreed. */
  'DATE_UNPARSEABLE',
  /** The source named a timezone that is not a usable IANA zone. */
  'TIMEZONE_INVALID',
  /** No timezone anywhere; UTC assumed and the precision lowered. */
  'TIMEZONE_ASSUMED',
  /** A fee was stated in two currencies at once; kept as text, never converted. */
  'FEE_AMBIGUOUS_CURRENCY',
  /** A fee string no pattern matched; the text is kept. */
  'FEE_UNPARSEABLE',
  /** A team-size phrase no pattern matched. */
  'TEAM_SIZE_UNPARSEABLE',
  /** Online keywords and a physical venue in the same record → HYBRID. */
  'MODE_CONFLICT',
  /** The title's year and the start date's year disagree; the start wins (A11). */
  'EDITION_YEAR_CONFLICT',
  /** A URL that was not http/https, or could not be parsed. */
  'URL_INVALID',
  /** Contact details were replaced in free text (D-29). */
  'PII_REDACTED',
  /** HTML that the sanitizer stripped something from. */
  'HTML_SANITIZED',
  /** The source's own type/category did not map to any `EventType`. */
  'EVENT_TYPE_UNMAPPED',
  /**
   * A place name matched several places and nothing could tell them apart, so
   * the location was left less precise rather than guessed (R55).
   */
  'GEO_AMBIGUOUS_PLACE',
  /**
   * The source stated a duration that disagrees with its own start and end by
   * an hour or more; the timestamps were kept and the duration ignored.
   */
  'DATE_DURATION_MISMATCH',
  /**
   * WP-12: the detail page could not be read this run (its host's robots.txt,
   * for one), so the listing's fields stand in.
   */
  'DETAIL_UNAVAILABLE',
] as const;
export const ParseWarningCode = z.enum(PARSE_WARNING_CODES);
export type ParseWarningCode = z.infer<typeof ParseWarningCode>;

/** One thing normalization could not do, in terms a professor can act on. */
export const ParseWarning = z
  .object({
    code: ParseWarningCode,
    /** The candidate field it concerns, when it concerns one. */
    field: z.string().optional(),
    message: z.string().min(1),
  })
  .strict();
export type ParseWarning = z.infer<typeof ParseWarning>;

/** A date as a source gave it: the instant, how precise it is, and the text. */
export const CandidateDate = z
  .object({
    at: z.int(),
    precision: DatePrecision,
    /** Exactly what the source said, kept for the provenance drawer. */
    raw: z.string().optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type CandidateDate = z.infer<typeof CandidateDate>;

/** An extra deadline an adapter found (§6.2 `event_deadlines`). */
export const CandidateDeadline = z
  .object({
    kind: DeadlineKind,
    label: z.string().min(1),
    dueAt: z.int(),
    precision: DatePrecision,
    raw: z.string().optional(),
  })
  .strict();
export type CandidateDeadline = z.infer<typeof CandidateDeadline>;

/**
 * Eligibility as structured flags, each with its own confidence (§6.2 Content).
 * Every flag is optional and **unknown is absent, never false** (§6.1): "we did
 * not find out whether postgraduates may enter" and "postgraduates may not
 * enter" are different answers and the UI shows them differently.
 */
export const CandidateEligibility = z
  .object({
    undergraduate: uncertain(z.boolean()).optional(),
    postgraduate: uncertain(z.boolean()).optional(),
    doctoral: uncertain(z.boolean()).optional(),
    /** Restricted to one gender, as the source stated it. */
    genderSpecific: uncertain(z.boolean()).optional(),
    indiaOnly: uncertain(z.boolean()).optional(),
    /** Only students of named institutions may enter. */
    institutionRestricted: uncertain(z.boolean()).optional(),
    /** Only certain academic years may enter. */
    yearRestricted: uncertain(z.boolean()).optional(),
    /** Only teams that qualified in an earlier round may enter (CTFtime "Prequalified"). */
    qualifiedOnly: uncertain(z.boolean()).optional(),
  })
  .strict();
export type CandidateEligibility = z.infer<typeof CandidateEligibility>;

/**
 * Where a source says the event happens — **as stated**, unresolved. No
 * geocoding and no institution matching: WP-08b owns the gazetteer, and it needs
 * the source's own words to do better than a wrong pin.
 */
export const CandidatePlace = z
  .object({
    venueName: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    countryCode: CountryCode.optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    /** Only set when the source itself supplied coordinates. */
    geoPrecision: GeoPrecision.optional(),
  })
  .strict();
export type CandidatePlace = z.infer<typeof CandidatePlace>;

/** What a source says it costs. Unknown is absent; **zero is a known price**. */
export const CandidateFee = z
  .object({
    /** True when the source stated a price, including "Free". */
    known: z.boolean(),
    /** Minor units, e.g. paise. Absent when `known` is false. */
    minor: z.int().min(0).optional(),
    currency: CurrencyCode.optional(),
    /** The original wording, kept whether or not it parsed. */
    text: z.string().optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .refine((fee) => !fee.known || (fee.minor !== undefined && fee.currency !== undefined), {
    message: 'A known fee needs both an amount and a currency.',
  });
export type CandidateFee = z.infer<typeof CandidateFee>;

/** How many people may enter together. Either bound may be unknown. */
export const CandidateTeamSize = z
  .object({
    min: z.int().min(1).optional(),
    max: z.int().min(1).optional(),
    text: z.string().optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .refine((size) => size.min === undefined || size.max === undefined || size.min <= size.max, {
    message: 'A team-size range cannot have min greater than max.',
  });
export type CandidateTeamSize = z.infer<typeof CandidateTeamSize>;

/**
 * The prize as stated. `totalMinor` is only set when a single unambiguous total
 * was found; a prize *table* stays as text, because "₹1,00,000 + ₹50,000 +
 * ₹25,000" is not a number anyone should invent.
 */
export const CandidatePrize = z
  .object({
    text: z.string().optional(),
    totalMinor: z.int().min(0).optional(),
    currency: CurrencyCode.optional(),
  })
  .strict()
  .refine((prize) => prize.totalMinor === undefined || prize.currency !== undefined, {
    message: 'A prize total needs a currency.',
  });
export type CandidatePrize = z.infer<typeof CandidatePrize>;

/**
 * A second value the same source stated for a field, and lost to (R63).
 *
 * CTFtime's structured `prizes` can say "$500" while the description says
 * "₹50,000". The structured field is the candidate's value; the other figure is
 * carried here, verbatim, so WP-10 can store it as an unselected
 * `event_field_claims` row and the UI can say "Sources disagree". Nothing is
 * converted, combined or chosen between: a currency conversion is a guess about
 * which of the two the organizer meant.
 */
export const CandidateAlternateClaim = z
  .object({
    field: OverrideField,
    value: z.union([z.string().min(1), z.number(), z.boolean()]),
    /** The source text the value was read from, already redacted. */
    sourceText: z.string().min(1),
    /** Why it is a second claim rather than the value, for the provenance drawer. */
    note: z.string().min(1),
  })
  .strict();
export type CandidateAlternateClaim = z.infer<typeof CandidateAlternateClaim>;

/**
 * Which series an event belongs to (§7.3 "Recurring rounds", WP-11).
 *
 * Set by an adapter that can see the whole listing — cadence inference needs
 * siblings — and otherwise computed at link time from the candidate alone. A
 * yearly edition is a series (`YEARLY`) but never a round: §7.5 does not merge
 * across editions, and the feed shows editions while hiding rounds.
 */
export const CandidateSeries = z
  .object({
    /** Normalized, lower-case, no digits — "codeforces round div". */
    key: z.string().min(1),
    /** Display name with the ordinal removed — "Codeforces Round (Div. 2)". */
    name: z.string().min(1),
    recurrence: Recurrence,
    isRecurringRound: z.boolean(),
    /** The ordinal that was stripped — "975". */
    roundLabel: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type CandidateSeries = z.infer<typeof CandidateSeries>;

/**
 * One event as one source described it, normalized (§7.1).
 *
 * `.strict()` at every level. That is the enforcement point for R50 and for a
 * quieter failure mode: an adapter that renames a field, or a source that grows
 * one, fails a test instead of silently dropping data into the void.
 */
export const EventCandidate = z
  .object({
    // ---- Identity at the source -------------------------------------------
    /** The `sources.key` this came from, e.g. `ctftime`. */
    sourceKey: z.string().min(1),
    /** The source's own stable id for this event; unique within the source. */
    externalKey: z.string().min(1),
    /** Canonical page for the event on the source. */
    url: z.url(),

    // ---- Identity of the event --------------------------------------------
    title: z.string().min(1),
    /** Exactly as the source wrote it, before cleaning. */
    titleRaw: z.string().min(1),
    eventType: uncertain(EventType),
    organizerName: z.string().min(1).optional(),
    organizerKind: uncertain(OrganizerKind).optional(),

    // ---- Content -----------------------------------------------------------
    /** Plain text, ≤ 500 characters, cut on a word boundary. */
    summary: z.string().max(500).optional(),
    /** Sanitized Markdown. Raw HTML is never stored (§7.3). */
    descriptionMd: z.string().optional(),
    prize: CandidatePrize.optional(),
    eligibilityText: z.string().optional(),
    eligibility: CandidateEligibility.optional(),
    requirementsText: z.string().optional(),
    submissionRequirementsText: z.string().optional(),

    // ---- Format and place --------------------------------------------------
    mode: uncertain(EventMode),
    place: CandidatePlace.optional(),
    /** IANA name, resolved by §7.3's precedence. Absent when nothing was usable. */
    timezone: z.string().min(1).optional(),

    // ---- Dates -------------------------------------------------------------
    registrationOpensAt: CandidateDate.optional(),
    registrationDeadlineAt: CandidateDate.optional(),
    startsAt: CandidateDate.optional(),
    endsAt: CandidateDate.optional(),
    submissionDeadlineAt: CandidateDate.optional(),
    resultAt: CandidateDate.optional(),
    /** Everything else with a due date (§6.2 `event_deadlines`). */
    deadlines: z.array(CandidateDeadline).optional(),

    // ---- Team and fee ------------------------------------------------------
    teamSize: CandidateTeamSize.optional(),
    fee: CandidateFee.optional(),

    // ---- Links -------------------------------------------------------------
    officialUrl: z.url().optional(),
    registrationUrl: z.url().optional(),

    // ---- Series and edition ------------------------------------------------
    editionYear: z.int().min(2020).max(2100).optional(),
    /** A rated round that would otherwise flood the feed (D-08). */
    isRecurringRound: z.boolean(),
    /** The series name with the round number stripped, e.g. "Codeforces Round". */
    seriesHint: z.string().min(1).optional(),
    /** The series this event belongs to, when the adapter could tell (WP-11). */
    series: CandidateSeries.optional(),

    // ---- Provenance --------------------------------------------------------
    /** The source's own labels, kept verbatim for WP-15b's category rules. */
    sourceTags: z.array(z.string().min(1)).optional(),
    /** Values this source also stated and that lost to a structured field (R63). */
    alternateClaims: z.array(CandidateAlternateClaim).optional(),
    warnings: z.array(ParseWarning),
  })
  .strict();
export type EventCandidate = z.infer<typeof EventCandidate>;

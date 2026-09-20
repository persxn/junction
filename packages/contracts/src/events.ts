import { z } from 'zod';

import {
  DATE_PRECISIONS,
  DatePrecision,
  EVENT_MODES,
  EVENT_TYPES,
  EventMode,
  EventType,
} from './enums.js';
import { Uuid7 } from './ids.js';

/**
 * The event vocabulary (§6.2 "Events" and "Places").
 *
 * Every enum here is the single source of truth for three things at once: the
 * TEXT + CHECK constraint in the migration, the zod shape the API validates
 * against, and the union the UI switches on. A test asserts the first of those
 * against the database, so a value added here without a migration fails
 * `pnpm verify` rather than at 2 a.m. on a scrape.
 *
 * `EventType`, `EventMode` and `DatePrecision` already existed in `enums.ts`
 * (they predate the events schema) and are re-exported so event code has one
 * import.
 */

export { DATE_PRECISIONS, DatePrecision, EVENT_MODES, EVENT_TYPES, EventMode, EventType };

/**
 * Who runs it (§6.2 Organizer). The Indian institute families are separate
 * values rather than one `UNIVERSITY` because they are how a professor actually
 * filters — "which IITs are running hackathons this month" is a real question,
 * and mapping it back out of a free-text organizer name is guesswork.
 */
export const ORGANIZER_KINDS = [
  'CORPORATE',
  'IIT',
  'NIT',
  'IIIT',
  'UNIVERSITY',
  'COLLEGE',
  'GOVERNMENT',
  'COMMUNITY',
  'PLATFORM',
  'OTHER',
  'UNKNOWN',
] as const;
export const OrganizerKind = z.enum(ORGANIZER_KINDS);
export type OrganizerKind = z.infer<typeof OrganizerKind>;

/**
 * How much the stored `lat`/`lon` actually means (§6.2 Format & place). A
 * city-centre coordinate is not a venue, and distance filtering has to know the
 * difference or "within 50 km" quietly becomes a lie.
 */
export const GEO_PRECISIONS = [
  'EXACT',
  'INSTITUTION',
  'CITY',
  'STATE',
  'COUNTRY',
  'UNKNOWN',
] as const;
export const GeoPrecision = z.enum(GEO_PRECISIONS);
export type GeoPrecision = z.infer<typeof GeoPrecision>;

/**
 * Why an event is or is not in the feed (§6.2 State, §7.4). `POLICY_HIDDEN` is
 * the geography and event-type policies' verdict, stored rather than applied at
 * query time so that changing a policy needs no re-scrape; `MERGED` means this
 * row lost a dedup merge and `merged_into_event_id` says to what.
 */
export const VISIBILITIES = ['VISIBLE', 'POLICY_HIDDEN', 'ADMIN_HIDDEN', 'MERGED'] as const;
export const Visibility = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof Visibility>;

/** §6.2 State. `POSTPONED` keeps the dates that were announced, flagged. */
export const CANCELLATIONS = ['NONE', 'CANCELLED', 'POSTPONED'] as const;
export const Cancellation = z.enum(CANCELLATIONS);
export type Cancellation = z.infer<typeof Cancellation>;

/** Whether a fact came from a source or a person. */
export const VALUE_ORIGINS = ['SOURCE', 'MANUAL'] as const;
export const ValueOrigin = z.enum(VALUE_ORIGINS);
export type ValueOrigin = z.infer<typeof ValueOrigin>;

/**
 * The kinds of date an event can have besides its start and end (§6.2
 * `event_deadlines`). They are rows rather than columns because a hackathon
 * routinely has four or five, and because each one needs its own precision and
 * provenance.
 */
export const DEADLINE_KINDS = [
  'REGISTRATION',
  'ABSTRACT',
  'IDEA_SUBMISSION',
  'PPT',
  'PROTOTYPE',
  'FINAL_SUBMISSION',
  'ROUND',
  'RESULT',
  'OTHER',
] as const;
export const DeadlineKind = z.enum(DEADLINE_KINDS);
export type DeadlineKind = z.infer<typeof DeadlineKind>;

/** How often a series runs (§6.2 `event_series`, D-08). */
export const RECURRENCES = [
  'NONE',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'YEARLY',
  'IRREGULAR',
] as const;
export const Recurrence = z.enum(RECURRENCES);
export type Recurrence = z.infer<typeof Recurrence>;

/** What made a field change (§6.2 `event_changes`). Drives "deadline changed". */
export const CHANGE_CAUSES = ['SCRAPE', 'OVERRIDE', 'MERGE', 'UNMERGE', 'MANUAL'] as const;
export const ChangeCause = z.enum(CHANGE_CAUSES);
export type ChangeCause = z.infer<typeof ChangeCause>;

/**
 * The fields a person may override, a source may claim, and a change may record
 * (§6.2 `event_overrides` / `event_field_claims` / `event_changes`).
 *
 * §6.2 leaves `field` as an open column; it is closed here on purpose. These
 * three tables are the provenance trail WP-10 resolves conflicts from and WP-16b
 * draws, and a free-text field name means two sources writing `startsAt` and
 * `starts_at` never disagree with each other. Columns that are computed
 * (`quality_score`), structural (`id`, `version`) or owned by another subsystem
 * (categories, tags) are deliberately absent: there is nothing to override.
 */
export const OVERRIDE_FIELDS = [
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
  'seriesId',
  'cancellation',
  'visibility',
] as const;
export const OverrideField = z.enum(OVERRIDE_FIELDS);
export type OverrideField = z.infer<typeof OverrideField>;

/** ISO 4217, upper-case (§6.1: money is minor units + currency). */
export const CurrencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/);

/** ISO 3166-1 alpha-2, upper-case. */
export const CountryCode = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/);

/** An instant, as §6.1 stores it: Unix milliseconds, UTC. */
export const Instant = z.int();

/**
 * A date the UI must render honestly: the instant plus how much of it the source
 * actually stated (ADR-0015). A `DATE` precision means "that local day, time not
 * stated" and is shown as such, never as 00:00.
 */
export const DatedValue = z
  .object({
    at: Instant,
    precision: DatePrecision,
  })
  .strict();
export type DatedValue = z.infer<typeof DatedValue>;

/** One of an event's extra dates (§6.2 `event_deadlines`). */
export const EventDeadline = z
  .object({
    id: Uuid7,
    kind: DeadlineKind,
    label: z.string().min(1),
    dueAt: Instant,
    precision: DatePrecision,
    origin: ValueOrigin,
  })
  .strict();
export type EventDeadline = z.infer<typeof EventDeadline>;

/**
 * What a feed row, a search hit and a calendar entry all need (§16.1). Kept
 * deliberately small: the list screens render thousands of these, and anything
 * here is something the query has to fetch.
 */
export const EventSummary = z
  .object({
    id: Uuid7,
    title: z.string().min(1),
    eventType: EventType,
    mode: EventMode,
    organizerName: z.string().nullable(),
    organizerKind: OrganizerKind,
    city: z.string().nullable(),
    countryCode: CountryCode.nullable(),
    startsAt: Instant.nullable(),
    endsAt: Instant.nullable(),
    registrationDeadlineAt: Instant.nullable(),
    registrationDeadlinePrecision: DatePrecision,
    datePrecision: DatePrecision,
    feeKnown: z.boolean(),
    feeMinor: z.int().nullable(),
    feeCurrency: CurrencyCode.nullable(),
    teamMin: z.int().nullable(),
    teamMax: z.int().nullable(),
    editionYear: z.int().nullable(),
    isRecurringRound: z.boolean(),
    cancellation: Cancellation,
    visibility: Visibility,
    qualityScore: z.int().min(0).max(100),
    hasConflicts: z.boolean(),
    officialUrl: z.url().nullable(),
  })
  .strict();
export type EventSummary = z.infer<typeof EventSummary>;

/** Everything the event page shows (§16.1). Read shape only — no routes yet. */
export const EventDetail = EventSummary.extend({
  normalizedTitle: z.string(),
  seriesId: Uuid7.nullable(),
  hostInstitutionId: Uuid7.nullable(),
  summary: z.string().nullable(),
  descriptionMd: z.string().nullable(),
  prizeText: z.string().nullable(),
  prizeTotalMinor: z.int().nullable(),
  prizeCurrency: CurrencyCode.nullable(),
  eligibilityText: z.string().nullable(),
  requirementsText: z.string().nullable(),
  submissionRequirementsText: z.string().nullable(),
  venueName: z.string().nullable(),
  state: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  geoPrecision: GeoPrecision,
  timezone: z.string().nullable(),
  registrationOpensAt: Instant.nullable(),
  submissionDeadlineAt: Instant.nullable(),
  feeText: z.string().nullable(),
  registrationUrl: z.url().nullable(),
  cancellationOrigin: ValueOrigin.nullable(),
  mergedIntoEventId: Uuid7.nullable(),
  policyReason: z.string().nullable(),
  lastVerifiedAt: Instant.nullable(),
  lastChangedAt: Instant,
  firstSeenAt: Instant,
  createdAt: Instant,
  updatedAt: Instant,
  version: z.int().min(1),
  deadlines: z.array(EventDeadline),
}).strict();
export type EventDetail = z.infer<typeof EventDetail>;

/** An institution events are hosted by (§6.2 Places). WP-08b seeds the table. */
export const INSTITUTION_KINDS = [
  'IIT',
  'NIT',
  'IIIT',
  'CENTRAL_UNIV',
  'STATE_UNIV',
  'PRIVATE_UNIV',
  'COLLEGE',
  'RESEARCH',
  'OTHER',
] as const;
export const InstitutionKind = z.enum(INSTITUTION_KINDS);
export type InstitutionKind = z.infer<typeof InstitutionKind>;

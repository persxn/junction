import {
  CANCELLATIONS,
  DATE_PRECISIONS,
  EVENT_MODES,
  EVENT_TYPES,
  GEO_PRECISIONS,
  ORGANIZER_KINDS,
  RECURRENCES,
  VALUE_ORIGINS,
  VISIBILITIES,
  type Cancellation,
  type DatePrecision,
  type EventMode,
  type EventType,
  type GeoPrecision,
  type OrganizerKind,
  type Recurrence,
  type ValueOrigin,
  type Visibility,
} from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { institutions } from './institutions.js';

/** `'A', 'B'` — CHECK lists are written from the contracts enums (§6.1). */
function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/**
 * The event core (§6.2 "Events", ruling R48).
 *
 * `events` is the row everything else in the product points at, so it is written
 * column for column against §6.2's group table rather than grown organically.
 * Three conventions from §6.1 are load-bearing here and worth saying out loud:
 *
 * - **Unknown is NULL, never 0.** A fee of zero means "free" and is a fact;
 *   an unknown fee is `fee_known = 0` with `fee_minor` NULL. The same applies to
 *   team sizes, prizes and coordinates.
 * - **Every date has a precision.** `date_precision` covers the start/end pair
 *   and `registration_deadline_precision` the registration deadline, because a
 *   source routinely states one to the minute and the other to the day.
 * - **Enums are TEXT + CHECK,** generated from the contracts lists, so a value
 *   the API accepts and the database rejects cannot exist.
 */
export const eventSeries = sqliteTable(
  'event_series',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    organizerName: text('organizer_name'),
    recurrence: text('recurrence').$type<Recurrence>().notNull().default('NONE'),
    /** Codeforces/LeetCode-style rated rounds, which the feed hides (D-08). */
    isRatedContest: integer('is_rated_contest', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('event_series_name_idx').on(table.name),
    check('event_series_recurrence_check', sql.raw(`"recurrence" in (${quoted(RECURRENCES)})`)),
  ],
);
export type EventSeriesRow = typeof eventSeries.$inferSelect;

export const events = sqliteTable(
  'events',
  {
    // ---- Identity ----------------------------------------------------------
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    /** Case-folded, punctuation-stripped title; the dedup and lookup key (WP-10). */
    normalizedTitle: text('normalized_title').notNull(),
    editionYear: integer('edition_year'),
    seriesId: text('series_id').references(() => eventSeries.id),
    eventType: text('event_type').$type<EventType>().notNull(),
    isRecurringRound: integer('is_recurring_round', { mode: 'boolean' }).notNull().default(false),

    // ---- Organizer ---------------------------------------------------------
    organizerName: text('organizer_name'),
    organizerKind: text('organizer_kind').$type<OrganizerKind>().notNull().default('UNKNOWN'),
    hostInstitutionId: text('host_institution_id').references(() => institutions.id),

    // ---- Content -----------------------------------------------------------
    /** Plain text, ≤ 500 characters (§6.2); the length is enforced by a CHECK. */
    summary: text('summary'),
    /** Sanitized Markdown. Raw HTML is never stored (§7.3). */
    descriptionMd: text('description_md'),
    prizeText: text('prize_text'),
    prizeTotalMinor: integer('prize_total_minor'),
    prizeCurrency: text('prize_currency'),
    eligibilityText: text('eligibility_text'),
    /** The structured flags, each with its own confidence (§6.2 Content). */
    eligibilityJson: text('eligibility_json'),
    requirementsText: text('requirements_text'),
    submissionRequirementsText: text('submission_requirements_text'),

    // ---- Format & place ----------------------------------------------------
    mode: text('mode').$type<EventMode>().notNull().default('UNKNOWN'),
    venueName: text('venue_name'),
    city: text('city'),
    state: text('state'),
    countryCode: text('country_code'),
    lat: real('lat'),
    lon: real('lon'),
    geoPrecision: text('geo_precision').$type<GeoPrecision>().notNull().default('UNKNOWN'),

    // ---- Dates -------------------------------------------------------------
    /** IANA name. NULL means no source stated one and none could be inferred. */
    timezone: text('timezone'),
    registrationOpensAt: integer('registration_opens_at'),
    registrationDeadlineAt: integer('registration_deadline_at'),
    registrationDeadlinePrecision: text('registration_deadline_precision')
      .$type<DatePrecision>()
      .notNull()
      .default('UNKNOWN'),
    startsAt: integer('starts_at'),
    endsAt: integer('ends_at'),
    submissionDeadlineAt: integer('submission_deadline_at'),
    datePrecision: text('date_precision').$type<DatePrecision>().notNull().default('UNKNOWN'),

    // ---- Team & fee --------------------------------------------------------
    teamMin: integer('team_min'),
    teamMax: integer('team_max'),
    /** Explicit, because "no fee" and "we do not know the fee" are different. */
    feeKnown: integer('fee_known', { mode: 'boolean' }).notNull().default(false),
    feeMinor: integer('fee_minor'),
    feeCurrency: text('fee_currency'),
    feeText: text('fee_text'),

    // ---- Links -------------------------------------------------------------
    officialUrl: text('official_url'),
    registrationUrl: text('registration_url'),

    // ---- State -------------------------------------------------------------
    cancellation: text('cancellation').$type<Cancellation>().notNull().default('NONE'),
    cancellationOrigin: text('cancellation_origin').$type<ValueOrigin>(),
    visibility: text('visibility').$type<Visibility>().notNull().default('VISIBLE'),
    mergedIntoEventId: text('merged_into_event_id').references((): AnySQLiteColumn => events.id),
    /** Why the policy hid it, shown to an admin (§7.4). */
    policyReason: text('policy_reason'),

    // ---- Quality -----------------------------------------------------------
    qualityScore: integer('quality_score').notNull().default(0),
    hasConflicts: integer('has_conflicts', { mode: 'boolean' }).notNull().default(false),
    lastVerifiedAt: integer('last_verified_at'),
    lastChangedAt: integer('last_changed_at').notNull(),
    firstSeenAt: integer('first_seen_at').notNull(),

    // ---- Audit -------------------------------------------------------------
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    // The nine indexes §6.2 lists, in its order.
    index('events_registration_deadline_at_idx').on(table.registrationDeadlineAt),
    index('events_starts_at_idx').on(table.startsAt),
    index('events_event_type_idx').on(table.eventType),
    index('events_mode_idx').on(table.mode),
    index('events_country_code_idx').on(table.countryCode),
    index('events_lat_lon_idx').on(table.lat, table.lon),
    index('events_visibility_idx').on(table.visibility),
    index('events_series_id_idx').on(table.seriesId),
    index('events_normalized_title_idx').on(table.normalizedTitle),

    check('events_event_type_check', sql.raw(`"event_type" in (${quoted(EVENT_TYPES)})`)),
    check(
      'events_organizer_kind_check',
      sql.raw(`"organizer_kind" in (${quoted(ORGANIZER_KINDS)})`),
    ),
    check('events_mode_check', sql.raw(`"mode" in (${quoted(EVENT_MODES)})`)),
    check('events_geo_precision_check', sql.raw(`"geo_precision" in (${quoted(GEO_PRECISIONS)})`)),
    check(
      'events_date_precision_check',
      sql.raw(`"date_precision" in (${quoted(DATE_PRECISIONS)})`),
    ),
    check(
      'events_registration_deadline_precision_check',
      sql.raw(`"registration_deadline_precision" in (${quoted(DATE_PRECISIONS)})`),
    ),
    check('events_cancellation_check', sql.raw(`"cancellation" in (${quoted(CANCELLATIONS)})`)),
    check(
      'events_cancellation_origin_check',
      sql.raw(
        `"cancellation_origin" is null or "cancellation_origin" in (${quoted(VALUE_ORIGINS)})`,
      ),
    ),
    check('events_visibility_check', sql.raw(`"visibility" in (${quoted(VISIBILITIES)})`)),

    // §6.1: money is minor units and is never negative; unknown is NULL.
    check('events_fee_minor_check', sql.raw(`"fee_minor" is null or "fee_minor" >= 0`)),
    check(
      'events_prize_total_minor_check',
      sql.raw(`"prize_total_minor" is null or "prize_total_minor" >= 0`),
    ),
    // A known fee needs an amount and a currency; an unknown one has neither.
    check(
      'events_fee_known_check',
      sql.raw(
        `("fee_known" = 0 and "fee_minor" is null) or ("fee_known" = 1 and "fee_minor" is not null and "fee_currency" is not null)`,
      ),
    ),
    check(
      'events_prize_currency_check',
      sql.raw(`"prize_total_minor" is null or "prize_currency" is not null`),
    ),
    check('events_team_min_check', sql.raw(`"team_min" is null or "team_min" >= 1`)),
    check(
      'events_team_max_check',
      sql.raw(
        `"team_max" is null or ("team_max" >= 1 and ("team_min" is null or "team_max" >= "team_min"))`,
      ),
    ),
    check('events_quality_score_check', sql.raw(`"quality_score" between 0 and 100`)),
    check('events_version_check', sql.raw(`"version" >= 1`)),
    check('events_summary_length_check', sql.raw(`"summary" is null or length("summary") <= 500`)),
    check('events_lat_check', sql.raw(`"lat" is null or "lat" between -90 and 90`)),
    check('events_lon_check', sql.raw(`"lon" is null or "lon" between -180 and 180`)),
    check(
      'events_country_code_check',
      sql.raw(
        `"country_code" is null or ("country_code" = upper("country_code") and length("country_code") = 2)`,
      ),
    ),
    // A merged row points somewhere; a row that points somewhere is merged.
    check(
      'events_merged_check',
      sql.raw(`("visibility" = 'MERGED') = ("merged_into_event_id" is not null)`),
    ),
    // Dates are stored UTC-ordered, so this is a real invariant, not a display one.
    check(
      'events_date_order_check',
      sql.raw(`"starts_at" is null or "ends_at" is null or "ends_at" >= "starts_at"`),
    ),
  ],
);
export type EventRow = typeof events.$inferSelect;

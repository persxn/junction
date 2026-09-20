-- WP-08a: the event schema (ARCHITECTURE.md §6.2 "Events" and "Places", ruling R48).
--
-- Creates event_series, events, event_deadlines, event_field_claims,
-- event_overrides, event_changes and institutions in one go. WP-10 resolves
-- conflicts out of the claim table and WP-16b draws the provenance drawer from
-- all three history tables, so splitting one schema across three work packages
-- would mean three migrations rebuilding each other's tables.
--
-- RULING R49 — the `source_record_id` columns on event_deadlines,
-- event_field_claims and event_changes are UNCONSTRAINED TEXT. They hold a
-- `source_records.id`, and that table arrives with WP-09a. SQLite cannot add a
-- foreign key to an existing table, so constraining them later would mean
-- rebuilding all three; the relation is enforced in the repository instead, and
-- WP-09a does NOT rebuild these tables to add it.
--
-- institutions is created empty. WP-08b seeds it and owns the matching logic;
-- this migration only needs somewhere for events.host_institution_id to point.

CREATE TABLE `event_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`field` text NOT NULL,
	`old_value_json` text,
	`new_value_json` text,
	`cause` text NOT NULL,
	`source_record_id` text,
	`changed_by` text,
	`detected_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_changes_field_check" CHECK("field" in ('title', 'eventType', 'organizerName', 'organizerKind', 'hostInstitutionId', 'summary', 'descriptionMd', 'prizeText', 'prizeTotalMinor', 'prizeCurrency', 'eligibilityText', 'requirementsText', 'submissionRequirementsText', 'mode', 'venueName', 'city', 'state', 'countryCode', 'lat', 'lon', 'geoPrecision', 'timezone', 'registrationOpensAt', 'registrationDeadlineAt', 'startsAt', 'endsAt', 'submissionDeadlineAt', 'teamMin', 'teamMax', 'feeKnown', 'feeMinor', 'feeCurrency', 'feeText', 'officialUrl', 'registrationUrl', 'editionYear', 'isRecurringRound', 'seriesId', 'cancellation', 'visibility')),
	CONSTRAINT "event_changes_cause_check" CHECK("cause" in ('SCRAPE', 'OVERRIDE', 'MERGE', 'UNMERGE', 'MANUAL')),
	CONSTRAINT "event_changes_value_check" CHECK("old_value_json" is not null or "new_value_json" is not null)
);
--> statement-breakpoint
CREATE INDEX `event_changes_event_id_idx` ON `event_changes` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_changes_detected_at_idx` ON `event_changes` (`detected_at`);--> statement-breakpoint
CREATE TABLE `event_deadlines` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`due_at` integer NOT NULL,
	`precision` text DEFAULT 'UNKNOWN' NOT NULL,
	`origin` text DEFAULT 'SOURCE' NOT NULL,
	`source_record_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_deadlines_kind_check" CHECK("kind" in ('REGISTRATION', 'ABSTRACT', 'IDEA_SUBMISSION', 'PPT', 'PROTOTYPE', 'FINAL_SUBMISSION', 'ROUND', 'RESULT', 'OTHER')),
	CONSTRAINT "event_deadlines_precision_check" CHECK("precision" in ('DATETIME', 'DATE', 'MONTH', 'UNKNOWN')),
	CONSTRAINT "event_deadlines_origin_check" CHECK("origin" in ('SOURCE', 'MANUAL'))
);
--> statement-breakpoint
CREATE INDEX `event_deadlines_event_id_idx` ON `event_deadlines` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_deadlines_due_at_idx` ON `event_deadlines` (`due_at`);--> statement-breakpoint
CREATE TABLE `event_field_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`field` text NOT NULL,
	`value_json` text,
	`source_record_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`is_selected` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_field_claims_field_check" CHECK("field" in ('title', 'eventType', 'organizerName', 'organizerKind', 'hostInstitutionId', 'summary', 'descriptionMd', 'prizeText', 'prizeTotalMinor', 'prizeCurrency', 'eligibilityText', 'requirementsText', 'submissionRequirementsText', 'mode', 'venueName', 'city', 'state', 'countryCode', 'lat', 'lon', 'geoPrecision', 'timezone', 'registrationOpensAt', 'registrationDeadlineAt', 'startsAt', 'endsAt', 'submissionDeadlineAt', 'teamMin', 'teamMax', 'feeKnown', 'feeMinor', 'feeCurrency', 'feeText', 'officialUrl', 'registrationUrl', 'editionYear', 'isRecurringRound', 'seriesId', 'cancellation', 'visibility'))
);
--> statement-breakpoint
CREATE INDEX `event_field_claims_event_id_idx` ON `event_field_claims` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_field_claims_source_record_id_idx` ON `event_field_claims` (`source_record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_field_claims_event_field_source_uq` ON `event_field_claims` (`event_id`,`field`,`source_record_id`);--> statement-breakpoint
CREATE TABLE `event_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`field` text NOT NULL,
	`value_json` text,
	`reason` text,
	`set_by` text NOT NULL,
	`set_at` integer NOT NULL,
	`cleared_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_overrides_field_check" CHECK("field" in ('title', 'eventType', 'organizerName', 'organizerKind', 'hostInstitutionId', 'summary', 'descriptionMd', 'prizeText', 'prizeTotalMinor', 'prizeCurrency', 'eligibilityText', 'requirementsText', 'submissionRequirementsText', 'mode', 'venueName', 'city', 'state', 'countryCode', 'lat', 'lon', 'geoPrecision', 'timezone', 'registrationOpensAt', 'registrationDeadlineAt', 'startsAt', 'endsAt', 'submissionDeadlineAt', 'teamMin', 'teamMax', 'feeKnown', 'feeMinor', 'feeCurrency', 'feeText', 'officialUrl', 'registrationUrl', 'editionYear', 'isRecurringRound', 'seriesId', 'cancellation', 'visibility'))
);
--> statement-breakpoint
CREATE INDEX `event_overrides_event_id_idx` ON `event_overrides` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_overrides_live_field_uq` ON `event_overrides` (`event_id`,`field`) WHERE "cleared_at" is null;--> statement-breakpoint
CREATE TABLE `event_series` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organizer_name` text,
	`recurrence` text DEFAULT 'NONE' NOT NULL,
	`is_rated_contest` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "event_series_recurrence_check" CHECK("recurrence" in ('NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY', 'IRREGULAR'))
);
--> statement-breakpoint
CREATE INDEX `event_series_name_idx` ON `event_series` (`name`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`edition_year` integer,
	`series_id` text,
	`event_type` text NOT NULL,
	`is_recurring_round` integer DEFAULT false NOT NULL,
	`organizer_name` text,
	`organizer_kind` text DEFAULT 'UNKNOWN' NOT NULL,
	`host_institution_id` text,
	`summary` text,
	`description_md` text,
	`prize_text` text,
	`prize_total_minor` integer,
	`prize_currency` text,
	`eligibility_text` text,
	`eligibility_json` text,
	`requirements_text` text,
	`submission_requirements_text` text,
	`mode` text DEFAULT 'UNKNOWN' NOT NULL,
	`venue_name` text,
	`city` text,
	`state` text,
	`country_code` text,
	`lat` real,
	`lon` real,
	`geo_precision` text DEFAULT 'UNKNOWN' NOT NULL,
	`timezone` text,
	`registration_opens_at` integer,
	`registration_deadline_at` integer,
	`registration_deadline_precision` text DEFAULT 'UNKNOWN' NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`submission_deadline_at` integer,
	`date_precision` text DEFAULT 'UNKNOWN' NOT NULL,
	`team_min` integer,
	`team_max` integer,
	`fee_known` integer DEFAULT false NOT NULL,
	`fee_minor` integer,
	`fee_currency` text,
	`fee_text` text,
	`official_url` text,
	`registration_url` text,
	`cancellation` text DEFAULT 'NONE' NOT NULL,
	`cancellation_origin` text,
	`visibility` text DEFAULT 'VISIBLE' NOT NULL,
	`merged_into_event_id` text,
	`policy_reason` text,
	`quality_score` integer DEFAULT 0 NOT NULL,
	`has_conflicts` integer DEFAULT false NOT NULL,
	`last_verified_at` integer,
	`last_changed_at` integer NOT NULL,
	`first_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `event_series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`host_institution_id`) REFERENCES `institutions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merged_into_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "events_event_type_check" CHECK("event_type" in ('HACKATHON', 'IDEATHON', 'INNOVATION_CHALLENGE', 'CTF', 'CODING_CONTEST', 'OTHER')),
	CONSTRAINT "events_organizer_kind_check" CHECK("organizer_kind" in ('CORPORATE', 'IIT', 'NIT', 'IIIT', 'UNIVERSITY', 'COLLEGE', 'GOVERNMENT', 'COMMUNITY', 'PLATFORM', 'OTHER', 'UNKNOWN')),
	CONSTRAINT "events_mode_check" CHECK("mode" in ('ONLINE', 'OFFLINE', 'HYBRID', 'UNKNOWN')),
	CONSTRAINT "events_geo_precision_check" CHECK("geo_precision" in ('EXACT', 'INSTITUTION', 'CITY', 'STATE', 'COUNTRY', 'UNKNOWN')),
	CONSTRAINT "events_date_precision_check" CHECK("date_precision" in ('DATETIME', 'DATE', 'MONTH', 'UNKNOWN')),
	CONSTRAINT "events_registration_deadline_precision_check" CHECK("registration_deadline_precision" in ('DATETIME', 'DATE', 'MONTH', 'UNKNOWN')),
	CONSTRAINT "events_cancellation_check" CHECK("cancellation" in ('NONE', 'CANCELLED', 'POSTPONED')),
	CONSTRAINT "events_cancellation_origin_check" CHECK("cancellation_origin" is null or "cancellation_origin" in ('SOURCE', 'MANUAL')),
	CONSTRAINT "events_visibility_check" CHECK("visibility" in ('VISIBLE', 'POLICY_HIDDEN', 'ADMIN_HIDDEN', 'MERGED')),
	CONSTRAINT "events_fee_minor_check" CHECK("fee_minor" is null or "fee_minor" >= 0),
	CONSTRAINT "events_prize_total_minor_check" CHECK("prize_total_minor" is null or "prize_total_minor" >= 0),
	CONSTRAINT "events_fee_known_check" CHECK(("fee_known" = 0 and "fee_minor" is null) or ("fee_known" = 1 and "fee_minor" is not null and "fee_currency" is not null)),
	CONSTRAINT "events_prize_currency_check" CHECK("prize_total_minor" is null or "prize_currency" is not null),
	CONSTRAINT "events_team_min_check" CHECK("team_min" is null or "team_min" >= 1),
	CONSTRAINT "events_team_max_check" CHECK("team_max" is null or ("team_max" >= 1 and ("team_min" is null or "team_max" >= "team_min"))),
	CONSTRAINT "events_quality_score_check" CHECK("quality_score" between 0 and 100),
	CONSTRAINT "events_version_check" CHECK("version" >= 1),
	CONSTRAINT "events_summary_length_check" CHECK("summary" is null or length("summary") <= 500),
	CONSTRAINT "events_lat_check" CHECK("lat" is null or "lat" between -90 and 90),
	CONSTRAINT "events_lon_check" CHECK("lon" is null or "lon" between -180 and 180),
	CONSTRAINT "events_country_code_check" CHECK("country_code" is null or ("country_code" = upper("country_code") and length("country_code") = 2)),
	CONSTRAINT "events_merged_check" CHECK(("visibility" = 'MERGED') = ("merged_into_event_id" is not null)),
	CONSTRAINT "events_date_order_check" CHECK("starts_at" is null or "ends_at" is null or "ends_at" >= "starts_at")
);
--> statement-breakpoint
CREATE INDEX `events_registration_deadline_at_idx` ON `events` (`registration_deadline_at`);--> statement-breakpoint
CREATE INDEX `events_starts_at_idx` ON `events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `events_event_type_idx` ON `events` (`event_type`);--> statement-breakpoint
CREATE INDEX `events_mode_idx` ON `events` (`mode`);--> statement-breakpoint
CREATE INDEX `events_country_code_idx` ON `events` (`country_code`);--> statement-breakpoint
CREATE INDEX `events_lat_lon_idx` ON `events` (`lat`,`lon`);--> statement-breakpoint
CREATE INDEX `events_visibility_idx` ON `events` (`visibility`);--> statement-breakpoint
CREATE INDEX `events_series_id_idx` ON `events` (`series_id`);--> statement-breakpoint
CREATE INDEX `events_normalized_title_idx` ON `events` (`normalized_title`);--> statement-breakpoint
CREATE TABLE `institutions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_name` text,
	`kind` text DEFAULT 'OTHER' NOT NULL,
	`city` text,
	`state` text,
	`country_code` text,
	`lat` real,
	`lon` real,
	`website_domain` text,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "institutions_kind_check" CHECK("kind" in ('IIT', 'NIT', 'IIIT', 'CENTRAL_UNIV', 'STATE_UNIV', 'PRIVATE_UNIV', 'COLLEGE', 'RESEARCH', 'OTHER')),
	CONSTRAINT "institutions_lat_check" CHECK("lat" is null or "lat" between -90 and 90),
	CONSTRAINT "institutions_lon_check" CHECK("lon" is null or "lon" between -180 and 180),
	CONSTRAINT "institutions_country_code_check" CHECK("country_code" is null or ("country_code" = upper("country_code") and length("country_code") = 2))
);
--> statement-breakpoint
CREATE INDEX `institutions_name_idx` ON `institutions` (`name`);--> statement-breakpoint
CREATE INDEX `institutions_city_idx` ON `institutions` (`city`);--> statement-breakpoint
CREATE INDEX `institutions_website_domain_idx` ON `institutions` (`website_domain`);
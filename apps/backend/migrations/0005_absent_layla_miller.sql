-- WP-09a: sources and ingestion (ARCHITECTURE.md §6.2 "Sources & ingestion",
-- §7.2, §7.6, rulings R58 and R59).
--
-- Creates sources, source_state, scrape_runs, source_records and http_cache.
-- The seed rows for the five sources of D-26 are the NEXT migration (0006), so
-- that the shape and the policy can be reviewed separately and so that a future
-- verdict change is a data migration rather than an edit to this file.
--
-- RULING R58 — http_cache holds the conditional-GET validators, keyed by URL
-- rather than by source record: listing URLs have no record, and detail URLs
-- outnumber records once pagination is involved.
--
-- RULING R59 — source_state, not job_state, holds consecutive_failures and
-- backoff_until. A source backoff is a politeness obligation towards somebody
-- else's server and must survive a job being renamed or re-registered;
-- job_state keeps only the runner's own health.
--
-- RULING R49 — the source_record_id columns on event_deadlines,
-- event_field_claims and event_changes STAY unconstrained TEXT. SQLite cannot
-- add a foreign key in place, and rebuilding three tables to gain a constraint
-- the repository already enforces is a bad trade. Those tables are untouched.
--
-- source_records.event_id is created but stays NULL through this work package:
-- matching a record to an event is WP-10's.

CREATE TABLE `http_cache` (
	`url` text PRIMARY KEY NOT NULL,
	`etag` text,
	`last_modified` text,
	`fetched_at` integer NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scrape_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`trigger` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`outcome` text NOT NULL,
	`error_kind` text,
	`error_detail` text,
	`listing_complete` integer DEFAULT false NOT NULL,
	`requests_made` integer DEFAULT 0 NOT NULL,
	`items_seen` integer DEFAULT 0 NOT NULL,
	`items_new` integer DEFAULT 0 NOT NULL,
	`items_updated` integer DEFAULT 0 NOT NULL,
	`items_unchanged` integer DEFAULT 0 NOT NULL,
	`items_invalid` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scrape_runs_trigger_check" CHECK("trigger" in ('SCHEDULE', 'MANUAL', 'STARTUP_CATCHUP')),
	CONSTRAINT "scrape_runs_outcome_check" CHECK("outcome" in ('SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED_OFFLINE', 'SKIPPED_BACKOFF', 'BLOCKED_BY_POLICY')),
	CONSTRAINT "scrape_runs_error_kind_check" CHECK("error_kind" is null or "error_kind" in ('NETWORK', 'DNS', 'TLS', 'TIMEOUT', 'HTTP_4XX', 'HTTP_5XX', 'BLOCKED', 'RATE_LIMITED', 'ROBOTS_DISALLOWED', 'PARSE', 'SCHEMA_CHANGED', 'UNKNOWN'))
);
--> statement-breakpoint
CREATE INDEX `scrape_runs_source_started_idx` ON `scrape_runs` (`source_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `source_records` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`external_key` text NOT NULL,
	`url` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_fetched_at` integer NOT NULL,
	`content_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`raw_snapshot_ref` text,
	`parse_warnings_json` text DEFAULT '[]' NOT NULL,
	`presence` text DEFAULT 'LISTED' NOT NULL,
	`missing_since` integer,
	`event_id` text,
	`match_method` text DEFAULT 'NEW' NOT NULL,
	`match_score` real,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "source_records_presence_check" CHECK("presence" in ('LISTED', 'MISSING', 'GONE')),
	CONSTRAINT "source_records_match_method_check" CHECK("match_method" in ('URL', 'AUTO_SCORE', 'MANUAL', 'NEW'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_records_source_external_key_idx` ON `source_records` (`source_id`,`external_key`);--> statement-breakpoint
CREATE INDEX `source_records_presence_idx` ON `source_records` (`source_id`,`presence`);--> statement-breakpoint
CREATE INDEX `source_records_event_id_idx` ON `source_records` (`event_id`);--> statement-breakpoint
CREATE INDEX `source_records_url_idx` ON `source_records` (`url`);--> statement-breakpoint
CREATE TABLE `source_state` (
	`source_id` text PRIMARY KEY NOT NULL,
	`last_run_at` integer,
	`last_success_at` integer,
	`next_due_at` integer NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`backoff_until` integer,
	`last_error_kind` text,
	`last_error_message` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "source_state_last_error_kind_check" CHECK("last_error_kind" is null or "last_error_kind" in ('NETWORK', 'DNS', 'TLS', 'TIMEOUT', 'HTTP_4XX', 'HTTP_5XX', 'BLOCKED', 'RATE_LIMITED', 'ROBOTS_DISALLOWED', 'PARSE', 'SCHEMA_CHANGED', 'UNKNOWN')),
	CONSTRAINT "source_state_consecutive_failures_check" CHECK("consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE INDEX `source_state_next_due_at_idx` ON `source_state` (`next_due_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`adapter` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`cadence_minutes` integer NOT NULL,
	`manual_min_interval_minutes` integer NOT NULL,
	`min_delay_ms` integer DEFAULT 3000 NOT NULL,
	`max_requests_per_run` integer NOT NULL,
	`allowed_paths_json` text DEFAULT '[]' NOT NULL,
	`attribution_text` text,
	`trust_rank` integer DEFAULT 0 NOT NULL,
	`compliance_status` text NOT NULL,
	`compliance_notes` text DEFAULT '' NOT NULL,
	`compliance_reviewed_at` integer,
	`compliance_reviewed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sources_adapter_check" CHECK("adapter" in ('CTFTIME_API', 'CLIST_API', 'DEVPOST', 'DEVFOLIO', 'UNSTOP', 'CONFIGURED_LISTING', 'MANUAL', 'URL_IMPORT')),
	CONSTRAINT "sources_compliance_status_check" CHECK("compliance_status" in ('APPROVED', 'APPROVED_WITH_LIMITS', 'MANUAL_IMPORT_ONLY', 'PENDING_REVIEW', 'BLOCKED')),
	CONSTRAINT "sources_cadence_minutes_check" CHECK("cadence_minutes" >= 1),
	CONSTRAINT "sources_min_delay_ms_check" CHECK("min_delay_ms" >= 0),
	CONSTRAINT "sources_max_requests_per_run_check" CHECK("max_requests_per_run" >= 1),
	CONSTRAINT "sources_version_check" CHECK("version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_key_idx` ON `sources` (`key`);
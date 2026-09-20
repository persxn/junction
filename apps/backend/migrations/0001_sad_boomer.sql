CREATE TABLE `job_state` (
	`job_key` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'GENERAL' NOT NULL,
	`last_run_at` integer,
	`last_success_at` integer,
	`next_due_at` integer NOT NULL,
	`running_since` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`backoff_until` integer,
	`last_outcome` text,
	`last_duration_ms` integer,
	`last_error_message` text,
	CONSTRAINT "job_state_kind_check" CHECK("kind" in ('SCRAPE', 'LLM', 'GENERAL')),
	CONSTRAINT "job_state_last_outcome_check" CHECK("last_outcome" is null or "last_outcome" in ('SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED_OFFLINE', 'SKIPPED_BACKOFF', 'ABORTED', 'CRASHED')),
	CONSTRAINT "job_state_consecutive_failures_check" CHECK("consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE INDEX `job_state_next_due_at_idx` ON `job_state` (`next_due_at`);
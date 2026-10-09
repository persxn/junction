CREATE TABLE `notification_preferences` (
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`is_enabled` integer NOT NULL,
	`thresholds_json` text,
	`toast_enabled` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`user_id`, `type`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_preferences_type_check" CHECK("type" in ('REG_DEADLINE', 'SUBMISSION_DEADLINE', 'STAGE_DUE', 'TASK_DUE', 'OVERDUE', 'NEW_MATCH', 'EVENT_CHANGED', 'EVENT_CANCELLED', 'SCRAPER_FAILING', 'BACKUP_FAILED', 'SOURCE_BLOCKED', 'CREDENTIAL_EXPIRED', 'SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`subject_kind` text,
	`subject_id` text,
	`route` text,
	`dedupe_key` text NOT NULL,
	`due_at` integer,
	`due_precision` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`snoozed_until` integer,
	`dismissed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notifications_type_check" CHECK("type" in ('REG_DEADLINE', 'SUBMISSION_DEADLINE', 'STAGE_DUE', 'TASK_DUE', 'OVERDUE', 'NEW_MATCH', 'EVENT_CHANGED', 'EVENT_CANCELLED', 'SCRAPER_FAILING', 'BACKUP_FAILED', 'SOURCE_BLOCKED', 'CREDENTIAL_EXPIRED', 'SYSTEM')),
	CONSTRAINT "notifications_severity_check" CHECK("severity" in ('INFO', 'WARNING', 'CRITICAL')),
	CONSTRAINT "notifications_precision_check" CHECK("due_precision" is null or "due_precision" in ('DATETIME', 'DATE', 'MONTH', 'UNKNOWN')),
	CONSTRAINT "notifications_route_check" CHECK("route" is null or "route" like '/%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_dedupe_uq` ON `notifications` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_inbox_idx` ON `notifications` (`user_id`,`read_at`,`snoozed_until`);--> statement-breakpoint
CREATE INDEX `notifications_snoozed_idx` ON `notifications` (`snoozed_until`);
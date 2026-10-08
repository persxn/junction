CREATE TABLE `engagement_mentors` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`from_at` integer NOT NULL,
	`to_at` integer,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "engagement_mentors_role_check" CHECK("role" in ('PRIMARY', 'CO_MENTOR'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engagement_mentors_open_primary_uq` ON `engagement_mentors` (`engagement_id`) WHERE "role" = 'PRIMARY' and "to_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `engagement_mentors_open_uq` ON `engagement_mentors` (`engagement_id`,`user_id`) WHERE "to_at" is null;--> statement-breakpoint
CREATE INDEX `engagement_mentors_user_id_idx` ON `engagement_mentors` (`user_id`);--> statement-breakpoint
CREATE TABLE `engagement_participants` (
	`engagement_id` text NOT NULL,
	`student_id` text NOT NULL,
	`event_id` text NOT NULL,
	`role_label` text,
	`added_at` integer NOT NULL,
	`removed_at` integer,
	`removal_reason` text,
	PRIMARY KEY(`engagement_id`, `student_id`),
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "engagement_participants_reason_check" CHECK(("removed_at" is null and "removal_reason" is null) or ("removed_at" is not null and "removal_reason" in ('REMOVED', 'ENGAGEMENT_CLOSED'))),
	CONSTRAINT "engagement_participants_role_label_check" CHECK("role_label" is null or length("role_label") <= 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engagement_participants_event_student_active_uq` ON `engagement_participants` (`event_id`,`student_id`) WHERE "removed_at" is null;--> statement-breakpoint
CREATE INDEX `engagement_participants_student_id_idx` ON `engagement_participants` (`student_id`);--> statement-breakpoint
CREATE TABLE `engagement_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`changed_by` text,
	`changed_at` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "engagement_status_history_to_check" CHECK("to_status" in ('CONSIDERING', 'ASSIGNED', 'APPLIED', 'PARTICIPATING', 'COMPLETED', 'WITHDRAWN', 'NOT_SELECTED')),
	CONSTRAINT "engagement_status_history_from_check" CHECK("from_status" is null or "from_status" in ('CONSIDERING', 'ASSIGNED', 'APPLIED', 'PARTICIPATING', 'COMPLETED', 'WITHDRAWN', 'NOT_SELECTED'))
);
--> statement-breakpoint
CREATE INDEX `engagement_status_history_engagement_idx` ON `engagement_status_history` (`engagement_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `engagements` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`event_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`team_id` text,
	`status` text NOT NULL,
	`status_changed_at` integer NOT NULL,
	`internal_notes` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "engagements_status_check" CHECK("status" in ('CONSIDERING', 'ASSIGNED', 'APPLIED', 'PARTICIPATING', 'COMPLETED', 'WITHDRAWN', 'NOT_SELECTED')),
	CONSTRAINT "engagements_kind_check" CHECK("participant_kind" in ('TEAM', 'INDIVIDUAL')),
	CONSTRAINT "engagements_team_kind_check" CHECK(("participant_kind" = 'TEAM' and "team_id" is not null) or ("participant_kind" = 'INDIVIDUAL' and "team_id" is null)),
	CONSTRAINT "engagements_version_check" CHECK("version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engagements_event_team_open_uq` ON `engagements` (`event_id`,`team_id`) WHERE "team_id" is not null and "status" not in ('WITHDRAWN', 'NOT_SELECTED');--> statement-breakpoint
CREATE INDEX `engagements_status_idx` ON `engagements` (`status`);--> statement-breakpoint
CREATE INDEX `engagements_team_id_idx` ON `engagements` (`team_id`);
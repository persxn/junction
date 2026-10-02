CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`student_id` text NOT NULL,
	`role_label` text,
	`is_lead` integer DEFAULT false NOT NULL,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_members_role_label_check" CHECK("role_label" is null or length("role_label") <= 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_open_uq` ON `team_members` (`team_id`,`student_id`) WHERE "left_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_open_lead_uq` ON `team_members` (`team_id`) WHERE "is_lead" = 1 and "left_at" is null;--> statement-breakpoint
CREATE INDEX `team_members_student_id_idx` ON `team_members` (`student_id`);--> statement-breakpoint
CREATE TABLE `team_mentors` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`from_at` integer NOT NULL,
	`to_at` integer,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_mentors_role_check" CHECK("role" in ('PRIMARY', 'CO_MENTOR'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_mentors_open_primary_uq` ON `team_mentors` (`team_id`) WHERE "role" = 'PRIMARY' and "to_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `team_mentors_open_uq` ON `team_mentors` (`team_id`,`user_id`) WHERE "to_at" is null;--> statement-breakpoint
CREATE INDEX `team_mentors_user_id_idx` ON `team_mentors` (`user_id`);--> statement-breakpoint
CREATE TABLE `team_skill_targets` (
	`team_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`team_id`, `tag_id`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "teams_status_check" CHECK("status" in ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "teams_version_check" CHECK("version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_active_name_uq` ON `teams` (`department_id`,`name_key`) WHERE "status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX `teams_status_idx` ON `teams` (`status`);
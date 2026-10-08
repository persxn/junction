CREATE TABLE `stage_assignees` (
	`stage_id` text NOT NULL,
	`student_id` text NOT NULL,
	PRIMARY KEY(`stage_id`, `student_id`),
	FOREIGN KEY (`stage_id`) REFERENCES `workflow_stages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`stage_id` text NOT NULL,
	`position` real NOT NULL,
	`title` text NOT NULL,
	`is_done` integer DEFAULT false NOT NULL,
	`done_at` integer,
	`done_by` text,
	`assignee_student_id` text,
	`due_at` integer,
	`notes` text,
	FOREIGN KEY (`stage_id`) REFERENCES `workflow_stages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_position_idx` ON `tasks` (`stage_id`,`position`);--> statement-breakpoint
CREATE TABLE `workflow_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`position` real NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`weight` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'NOT_STARTED' NOT NULL,
	`blocked_reason` text,
	`due_at` integer,
	`due_rule_json` text,
	`due_origin` text DEFAULT 'NONE' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`completed_by` text,
	`progress_override` integer,
	`completed_with_open_tasks` integer DEFAULT false NOT NULL,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workflow_stages_status_check" CHECK("status" in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'SKIPPED')),
	CONSTRAINT "workflow_stages_origin_check" CHECK("due_origin" in ('RULE', 'MANUAL', 'NONE')),
	CONSTRAINT "workflow_stages_weight_check" CHECK("weight" between 0 and 10),
	CONSTRAINT "workflow_stages_override_check" CHECK("progress_override" is null or "progress_override" between 0 and 100),
	CONSTRAINT "workflow_stages_blocked_check" CHECK("status" <> 'BLOCKED' or "blocked_reason" is not null),
	CONSTRAINT "workflow_stages_version_check" CHECK("version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `workflow_stages_position_idx` ON `workflow_stages` (`workflow_id`,`position`);--> statement-breakpoint
CREATE TABLE `workflow_template_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`position` real NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`weight` integer DEFAULT 1 NOT NULL,
	`due_rule_json` text,
	`default_tasks_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `workflow_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workflow_template_stages_weight_check" CHECK("weight" between 0 and 10)
);
--> statement-breakpoint
CREATE INDEX `workflow_template_stages_position_idx` ON `workflow_template_stages` (`template_id`,`position`);--> statement-breakpoint
CREATE TABLE `workflow_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`applies_to_event_type` text,
	`is_default_for_type` integer DEFAULT false NOT NULL,
	`version_no` integer DEFAULT 1 NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workflow_templates_type_check" CHECK("applies_to_event_type" is null or "applies_to_event_type" in ('HACKATHON', 'IDEATHON', 'INNOVATION_CHALLENGE', 'CTF', 'CODING_CONTEST', 'OTHER')),
	CONSTRAINT "workflow_templates_version_check" CHECK("version_no" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_templates_default_uq` ON `workflow_templates` (`department_id`,`applies_to_event_type`) WHERE "is_default_for_type" = 1 and "is_archived" = 0;--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`template_id` text,
	`template_version_no` integer,
	`created_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `workflow_templates`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workflows_version_check" CHECK("version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflows_engagement_uq` ON `workflows` (`engagement_id`);
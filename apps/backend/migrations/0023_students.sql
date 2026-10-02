CREATE TABLE `mentorships` (
	`id` text PRIMARY KEY NOT NULL,
	`mentor_user_id` text NOT NULL,
	`student_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`note` text,
	`created_by` text,
	FOREIGN KEY (`mentor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mentorships_open_uq` ON `mentorships` (`mentor_user_id`,`student_id`) WHERE "mentorships"."ended_at" is null;--> statement-breakpoint
CREATE INDEX `mentorships_student_id_idx` ON `mentorships` (`student_id`);--> statement-breakpoint
CREATE INDEX `mentorships_mentor_user_id_idx` ON `mentorships` (`mentor_user_id`);--> statement-breakpoint
CREATE TABLE `student_achievements` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`title` text NOT NULL,
	`event_name` text,
	`year` integer,
	`result` text,
	`url` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `student_achievements_student_id_idx` ON `student_achievements` (`student_id`);--> statement-breakpoint
CREATE TABLE `student_tags` (
	`student_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`relation` text NOT NULL,
	`proficiency` integer,
	PRIMARY KEY(`student_id`, `tag_id`, `relation`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "student_tags_relation_check" CHECK("relation" in ('SKILL', 'INTEREST')),
	CONSTRAINT "student_tags_proficiency_check" CHECK("proficiency" is null or "proficiency" between 1 and 3)
);
--> statement-breakpoint
CREATE INDEX `student_tags_tag_id_idx` ON `student_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`university_id` text NOT NULL,
	`university_id_key` text NOT NULL,
	`full_name` text NOT NULL,
	`preferred_name` text,
	`institutional_email` text,
	`phone` text,
	`home_department_id` text NOT NULL,
	`program` text NOT NULL,
	`branch` text,
	`graduation_year` integer,
	`is_external` integer DEFAULT false NOT NULL,
	`external_institution` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`notes` text,
	`privacy_notice_ack_at` integer,
	`erased_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "students_program_check" CHECK("program" in ('BTECH', 'MTECH', 'BSC', 'MSC', 'BCA', 'MCA', 'PHD', 'OTHER')),
	CONSTRAINT "students_status_check" CHECK("status" in ('ACTIVE', 'INACTIVE', 'ALUMNI')),
	CONSTRAINT "students_graduation_year_check" CHECK("graduation_year" is null or "graduation_year" between 1950 and 2100),
	CONSTRAINT "students_notes_length_check" CHECK("notes" is null or length("notes") <= 500),
	CONSTRAINT "students_version_check" CHECK("version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_org_university_id_key_uq` ON `students` (`organization_id`,`university_id_key`);--> statement-breakpoint
CREATE INDEX `students_full_name_idx` ON `students` (`full_name`);--> statement-breakpoint
CREATE INDEX `students_status_idx` ON `students` (`status`);--> statement-breakpoint
CREATE INDEX `students_program_idx` ON `students` (`program`);--> statement-breakpoint
CREATE INDEX `students_graduation_year_idx` ON `students` (`graduation_year`);
CREATE TABLE `saved_search_matches` (
	`saved_search_id` text NOT NULL,
	`event_id` text NOT NULL,
	`first_matched_at` integer NOT NULL,
	PRIMARY KEY(`saved_search_id`, `event_id`),
	FOREIGN KEY (`saved_search_id`) REFERENCES `saved_searches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_search_matches_event_id_idx` ON `saved_search_matches` (`event_id`);--> statement-breakpoint
CREATE TABLE `saved_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`department_id` text,
	`name` text NOT NULL,
	`query_json` text NOT NULL,
	`notify_on_new` integer DEFAULT true NOT NULL,
	`last_evaluated_at` integer,
	`last_result_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "saved_searches_version_check" CHECK("saved_searches"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_searches_user_name_uq` ON `saved_searches` (`user_id`,`name`);
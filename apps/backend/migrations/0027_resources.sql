CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`uri` text NOT NULL,
	`machine_label` text,
	`last_checked_at` integer,
	`check_status` text DEFAULT 'UNCHECKED' NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "resources_owner_kind_check" CHECK("owner_kind" in ('ENGAGEMENT', 'STAGE', 'TASK', 'OUTCOME')),
	CONSTRAINT "resources_kind_check" CHECK("kind" in ('URL', 'GITHUB', 'CLOUD_DOC', 'LOCAL_PATH', 'OTHER')),
	CONSTRAINT "resources_check_status_check" CHECK("check_status" in ('OK', 'MISSING', 'UNREACHABLE', 'UNCHECKED')),
	CONSTRAINT "resources_uri_length_check" CHECK(length("uri") between 1 and 2048),
	CONSTRAINT "resources_label_length_check" CHECK(length("label") between 1 and 120),
	CONSTRAINT "resources_machine_label_check" CHECK("machine_label" is null or length("machine_label") between 1 and 64),
	CONSTRAINT "resources_machine_label_kind_check" CHECK("machine_label" is null or "kind" = 'LOCAL_PATH'),
	CONSTRAINT "resources_version_check" CHECK("version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `resources_owner_idx` ON `resources` (`owner_kind`,`owner_id`);
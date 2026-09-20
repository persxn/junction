CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` integer NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`summary` text NOT NULL,
	`diff_json` text DEFAULT '{}' NOT NULL,
	`request_id` text,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "audit_log_actor_kind_check" CHECK("actor_kind" in ('USER', 'SYSTEM', 'SCHEDULER', 'AI')),
	CONSTRAINT "audit_log_hash_check" CHECK(length("hash") = 64 and length("prev_hash") = 64)
);
--> statement-breakpoint
CREATE INDEX `audit_log_occurred_at_idx` ON `audit_log` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_user_id_idx` ON `audit_log` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_kind`,`entity_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT "roles_key_check" CHECK("key" in ('ADMINISTRATOR', 'PROFESSOR'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_key_uq` ON `roles` (`key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`client_kind` text DEFAULT 'DESKTOP' NOT NULL,
	`client_label` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_client_kind_check" CHECK("client_kind" in ('DESKTOP', 'WEB'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_absolute_expires_at_idx` ON `sessions` (`absolute_expires_at`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`granted_at` integer NOT NULL,
	`granted_by` text,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_roles_role_id_idx` ON `user_roles` (`role_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_status_check" CHECK("status" in ('ACTIVE', 'DISABLED')),
	CONSTRAINT "users_failed_login_count_check" CHECK("failed_login_count" >= 0),
	CONSTRAINT "users_email_lowercase_check" CHECK("email" = lower("email"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_department_id_idx` ON `users` (`department_id`);--> statement-breakpoint
CREATE TABLE `campuses` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`lat` real,
	`lon` real,
	`is_primary` integer DEFAULT false NOT NULL,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campuses_lat_range_check" CHECK("lat" is null or ("lat" >= -90 and "lat" <= 90)),
	CONSTRAINT "campuses_lon_range_check" CHECK("lon" is null or ("lon" >= -180 and "lon" <= 180))
);
--> statement-breakpoint
CREATE INDEX `campuses_organization_id_idx` ON `campuses` (`organization_id`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`is_managing` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `departments_organization_id_idx` ON `departments` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `departments_org_code_uq` ON `departments` (`organization_id`,`code`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL
);

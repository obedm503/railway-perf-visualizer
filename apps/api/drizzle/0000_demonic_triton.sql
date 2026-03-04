CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`scope` text,
	`token_type` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_provider_subject_unique` ON `identities` (`provider`,`provider_subject`);--> statement-breakpoint
CREATE INDEX `identities_user_idx` ON `identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`code_verifier` text NOT NULL,
	`callback_url` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_states_expires_at_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_subject` text NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`name` text,
	`picture` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_provider_subject_unique` ON `users` (`provider_subject`);
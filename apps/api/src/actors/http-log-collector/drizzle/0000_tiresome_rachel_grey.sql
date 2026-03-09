CREATE TABLE `histograms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deployment_id` text NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`buckets` text NOT NULL,
	`total_count` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `histograms_deployment_window_idx` ON `histograms` (`deployment_id`,`window_start`);--> statement-breakpoint
CREATE INDEX `histograms_window_start_idx` ON `histograms` (`window_start`);--> statement-breakpoint
CREATE TABLE `http_logs` (
	`request_id` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`host` text NOT NULL,
	`http_status` integer NOT NULL,
	`total_duration` real NOT NULL,
	`upstream_rq_duration` real NOT NULL,
	`edge_region` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `http_logs_deployment_idx` ON `http_logs` (`deployment_id`);--> statement-breakpoint
CREATE INDEX `http_logs_timestamp_idx` ON `http_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `http_logs_deployment_timestamp_idx` ON `http_logs` (`deployment_id`,`timestamp`);
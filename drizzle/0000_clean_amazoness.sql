CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`message` text NOT NULL,
	`error` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runs_project_created` ON `agent_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_runs_idempotency` ON `agent_runs` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version` integer NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`content_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_versions_artifact_version` ON `artifact_versions` (`artifact_id`,`version`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`content_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_project_kind` ON `artifacts` (`project_id`,`kind`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`storage_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_hash` text NOT NULL,
	`rights_status` text NOT NULL,
	`provenance_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_assets_project_created` ON `assets` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`logline` text NOT NULL,
	`status` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`hook` text NOT NULL,
	`cliffhanger` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_episodes_project_number` ON `episodes` (`project_id`,`number`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`severity` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text NOT NULL,
	`owner_agent_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_issues_project_status` ON `issues` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`premise` text NOT NULL,
	`logline` text NOT NULL,
	`state` text NOT NULL,
	`format` text NOT NULL,
	`aspect_ratio` text NOT NULL,
	`language` text NOT NULL,
	`content_rating` text NOT NULL,
	`episode_count` integer NOT NULL,
	`target_duration_sec` integer NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`mode` text DEFAULT 'manual' NOT NULL,
	`poster_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_slug` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_projects_updated_at` ON `projects` (`updated_at`);--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_run_events_run_id` ON `run_events` (`run_id`,`id`);
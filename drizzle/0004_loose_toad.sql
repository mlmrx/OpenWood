CREATE TABLE `audience_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`manifest_artifact_id` text NOT NULL,
	`manifest_version` integer NOT NULL,
	`prompt_id` text NOT NULL,
	`option_id` text NOT NULL,
	`viewer_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`manifest_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_audience_signals_viewer_manifest_prompt` ON `audience_signals` (`manifest_artifact_id`,`manifest_version`,`prompt_id`,`viewer_key`);--> statement-breakpoint
CREATE INDEX `idx_audience_signals_manifest_prompt_option` ON `audience_signals` (`manifest_artifact_id`,`manifest_version`,`prompt_id`,`option_id`);--> statement-breakpoint
CREATE INDEX `idx_audience_signals_project_updated` ON `audience_signals` (`project_id`,`updated_at`);

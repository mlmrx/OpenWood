CREATE TABLE `audience_signal_rate_windows` (
	`project_id` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`attempts` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "audience_signal_rate_windows_attempts_check" CHECK("audience_signal_rate_windows"."attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE `story_door_states` (
	`project_id` text NOT NULL,
	`manifest_artifact_id` text NOT NULL,
	`manifest_version` integer NOT NULL,
	`prompt_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_by_workspace_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`manifest_artifact_id`, `manifest_version`, `prompt_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`manifest_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "story_door_states_status_check" CHECK("story_door_states"."status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `idx_story_door_states_project_manifest` ON `story_door_states` (`project_id`,`manifest_artifact_id`,`manifest_version`);
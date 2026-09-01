CREATE TABLE `system_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `workspace_id` text NOT NULL DEFAULT 'legacy';--> statement-breakpoint
CREATE INDEX `idx_projects_workspace_updated` ON `projects` (`workspace_id`,`updated_at`);

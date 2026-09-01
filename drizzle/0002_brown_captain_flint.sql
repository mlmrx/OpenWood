DROP INDEX `idx_artifacts_project_kind`;--> statement-breakpoint
DELETE FROM `artifacts`
WHERE EXISTS (
  SELECT 1 FROM `artifacts` `newer`
  WHERE `newer`.`project_id` = `artifacts`.`project_id`
    AND `newer`.`kind` = `artifacts`.`kind`
    AND (
      `newer`.`updated_at` > `artifacts`.`updated_at`
      OR (`newer`.`updated_at` = `artifacts`.`updated_at` AND `newer`.`id` > `artifacts`.`id`)
    )
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifacts_project_kind_unique` ON `artifacts` (`project_id`,`kind`);--> statement-breakpoint
UPDATE `agent_runs`
SET `status` = 'failed',
    `progress` = 0,
    `message` = 'Superseded duplicate active stage lease during schema hardening.',
    `error` = 'Only one active run is allowed per production stage.'
WHERE `status` = 'running'
  AND EXISTS (
    SELECT 1 FROM `agent_runs` `newer`
    WHERE `newer`.`project_id` = `agent_runs`.`project_id`
      AND `newer`.`stage` = `agent_runs`.`stage`
      AND `newer`.`status` = 'running'
      AND (
        `newer`.`created_at` > `agent_runs`.`created_at`
        OR (`newer`.`created_at` = `agent_runs`.`created_at` AND `newer`.`id` > `agent_runs`.`id`)
      )
  );--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_runs_active_stage` ON `agent_runs` (`project_id`,`stage`) WHERE "agent_runs"."status" = 'running';

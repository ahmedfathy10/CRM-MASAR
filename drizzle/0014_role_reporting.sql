ALTER TABLE `job_titles` ADD `reports_to_id` integer REFERENCES `job_titles`(`id`);
--> statement-breakpoint
CREATE INDEX `job_titles_reports_to_idx` ON `job_titles` (`reports_to_id`);

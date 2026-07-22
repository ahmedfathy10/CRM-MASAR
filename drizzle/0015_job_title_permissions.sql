CREATE TABLE `job_title_permissions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_title_id` integer NOT NULL,
  `page_key` text NOT NULL,
  `can_view` integer DEFAULT false NOT NULL,
  `can_add` integer DEFAULT false NOT NULL,
  `can_edit` integer DEFAULT false NOT NULL,
  `can_delete` integer DEFAULT false NOT NULL,
  FOREIGN KEY (`job_title_id`) REFERENCES `job_titles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_title_permissions_unique_idx` ON `job_title_permissions` (`job_title_id`,`page_key`);

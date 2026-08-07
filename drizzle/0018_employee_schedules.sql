CREATE TABLE IF NOT EXISTS `employee_schedules` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employee_id` integer NOT NULL,
  `work_date` text NOT NULL,
  `day_status` text NOT NULL CHECK (`day_status` IN ('work', 'leave')),
  `leave_type` text NOT NULL DEFAULT '',
  `notes` text NOT NULL DEFAULT '',
  `created_by_employee_id` integer,
  `created_by_name` text NOT NULL DEFAULT '',
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`),
  FOREIGN KEY (`created_by_employee_id`) REFERENCES `employees`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `employee_schedules_employee_date_idx` ON `employee_schedules` (`employee_id`,`work_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `employee_schedules_date_idx` ON `employee_schedules` (`work_date`,`employee_id`);

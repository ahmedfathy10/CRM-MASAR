ALTER TABLE `employee_schedules` ADD COLUMN `shift_from` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `employee_schedules` ADD COLUMN `shift_to` text NOT NULL DEFAULT '';

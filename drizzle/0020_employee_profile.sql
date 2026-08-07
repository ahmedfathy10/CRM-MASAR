CREATE TABLE IF NOT EXISTS `employee_adjustments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employee_id` integer NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('reward','deduction')),
  `title` text NOT NULL,
  `value` text NOT NULL DEFAULT '',
  `notes` text NOT NULL DEFAULT '',
  `record_date` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by_employee_id` integer,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`),
  FOREIGN KEY (`created_by_employee_id`) REFERENCES `employees`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `class_visits` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `teacher_id` integer NOT NULL,
  `group_id` integer,
  `visit_date` text NOT NULL,
  `score` real NOT NULL DEFAULT 0,
  `notes` text NOT NULL DEFAULT '',
  `visited_by_employee_id` integer,
  `visited_by_name` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`teacher_id`) REFERENCES `employees`(`id`),
  FOREIGN KEY (`group_id`) REFERENCES `settings_entities`(`id`),
  FOREIGN KEY (`visited_by_employee_id`) REFERENCES `employees`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `employee_tasks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employee_id` integer NOT NULL,
  `title` text NOT NULL,
  `due_date` text NOT NULL DEFAULT '',
  `is_completed` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`)
);

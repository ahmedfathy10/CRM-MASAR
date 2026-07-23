ALTER TABLE `employees` ADD `password_hash` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `employee_sessions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `token` text NOT NULL,
  `employee_id` integer NOT NULL,
  `expires_at` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_sessions_token_idx` ON `employee_sessions` (`token`);

CREATE TABLE `branches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`primary_phone` text DEFAULT '' NOT NULL,
	`secondary_phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`social_url` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `call_records` ADD `branch_id` integer REFERENCES branches(id);--> statement-breakpoint
ALTER TABLE `employees` ADD `branch_id` integer REFERENCES branches(id);--> statement-breakpoint
ALTER TABLE `leads` ADD `branch_id` integer REFERENCES branches(id);
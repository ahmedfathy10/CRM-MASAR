CREATE TABLE `call_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer,
	`phone` text NOT NULL,
	`direction` text DEFAULT 'outgoing' NOT NULL,
	`result` text DEFAULT 'no_answer' NOT NULL,
	`assigned_employee_id` integer,
	`call_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`custom_data` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text NOT NULL,
	`primary_phone` text NOT NULL,
	`normalized_phone` text NOT NULL,
	`secondary_phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'غير محدد' NOT NULL,
	`campaign` text DEFAULT '' NOT NULL,
	`interest` text DEFAULT '' NOT NULL,
	`assigned_employee_id` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`custom_data` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`assigned_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_phone_idx` ON `leads` (`normalized_phone`);
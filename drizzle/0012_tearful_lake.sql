CREATE TABLE `students` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text NOT NULL,
	`mobile` text DEFAULT '' NOT NULL,
	`level_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`level_id`) REFERENCES `settings_entities`(`id`) ON UPDATE no action ON DELETE no action
);

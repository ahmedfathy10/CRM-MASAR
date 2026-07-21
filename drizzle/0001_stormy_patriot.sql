ALTER TABLE `departments` ADD `parent_id` integer;--> statement-breakpoint
ALTER TABLE `departments` ADD `support_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `form_fields_key_idx` ON `form_fields` (`form_id`,`field_key`);
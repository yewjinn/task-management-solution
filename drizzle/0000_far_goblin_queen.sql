CREATE TABLE `board_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`due_date` text,
	`priority` text DEFAULT 'none' NOT NULL,
	`effort` text DEFAULT 'medium' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`position` integer NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cards_list_position_idx` ON `cards` (`list_id`,`position`);--> statement-breakpoint
CREATE INDEX `cards_due_date_idx` ON `cards` (`due_date`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lists_position_idx` ON `lists` (`position`);

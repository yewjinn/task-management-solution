ALTER TABLE `cards` ADD `task_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `cards_task_number_idx` ON `cards` (`task_number`);
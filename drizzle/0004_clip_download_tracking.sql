ALTER TABLE `clips` ADD `download_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `download_error` text;--> statement-breakpoint
ALTER TABLE `clips` ADD `download_retry_after_utc` text;
ALTER TABLE `autopost_rules` ADD `next_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `autopost_rules` ADD `skipped_clip_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `render_json` text;
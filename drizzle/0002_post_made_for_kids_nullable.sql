PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`clip_id` text,
	`rule_id` integer,
	`status` text NOT NULL,
	`visibility_mode` text DEFAULT 'schedule' NOT NULL,
	`publish_at_utc` text,
	`upload_after_utc` text,
	`file_path` text,
	`file_size` integer,
	`file_mtime` integer,
	`duration_sec` real,
	`width` integer,
	`height` integer,
	`is_short` integer DEFAULT false NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`category_id` text,
	`playlist_id` text,
	`thumbnail_path` text,
	`made_for_kids` integer,
	`notify_subscribers` integer DEFAULT true NOT NULL,
	`license` text DEFAULT 'youtube' NOT NULL,
	`embeddable` integer DEFAULT true NOT NULL,
	`default_language` text,
	`default_audio_language` text,
	`synthetic_media` integer DEFAULT false NOT NULL,
	`missed_policy` text DEFAULT 'ask' NOT NULL,
	`template_id` integer,
	`series_id` integer,
	`series_number` integer,
	`youtube_video_id` text,
	`upload_progress` real DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rule_id`) REFERENCES `autopost_rules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_posts`("id", "account_id", "source", "clip_id", "rule_id", "status", "visibility_mode", "publish_at_utc", "upload_after_utc", "file_path", "file_size", "file_mtime", "duration_sec", "width", "height", "is_short", "title", "description", "tags_json", "category_id", "playlist_id", "thumbnail_path", "made_for_kids", "notify_subscribers", "license", "embeddable", "default_language", "default_audio_language", "synthetic_media", "missed_policy", "template_id", "series_id", "series_number", "youtube_video_id", "upload_progress", "attempts", "last_error", "created_at", "updated_at") SELECT "id", "account_id", "source", "clip_id", "rule_id", "status", "visibility_mode", "publish_at_utc", "upload_after_utc", "file_path", "file_size", "file_mtime", "duration_sec", "width", "height", "is_short", "title", "description", "tags_json", "category_id", "playlist_id", "thumbnail_path", "made_for_kids", "notify_subscribers", "license", "embeddable", "default_language", "default_audio_language", "synthetic_media", "missed_policy", "template_id", "series_id", "series_number", "youtube_video_id", "upload_progress", "attempts", "last_error", "created_at", "updated_at" FROM `posts`;--> statement-breakpoint
DROP TABLE `posts`;--> statement-breakpoint
ALTER TABLE `__new_posts` RENAME TO `posts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `posts_clip_account_active_uq` ON `posts` (`clip_id`,`account_id`) WHERE "posts"."clip_id" IS NOT NULL AND "posts"."status" <> 'canceled';--> statement-breakpoint
CREATE UNIQUE INDEX `posts_youtube_video_id_uq` ON `posts` (`youtube_video_id`) WHERE "posts"."youtube_video_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `posts_status_upload_after_idx` ON `posts` (`status`,`upload_after_utc`);--> statement-breakpoint
CREATE INDEX `posts_publish_at_idx` ON `posts` (`publish_at_utc`);--> statement-breakpoint
CREATE INDEX `posts_account_idx` ON `posts` (`account_id`);
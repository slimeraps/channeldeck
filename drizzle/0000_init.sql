CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`channel_title` text NOT NULL,
	`channel_handle` text,
	`avatar_url` text,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`enc_refresh_token` blob,
	`token_status` text DEFAULT 'ok' NOT NULL,
	`defaults_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_channel_id_unique` ON `accounts` (`channel_id`);--> statement-breakpoint
CREATE TABLE `autopost_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`youtube_account_id` integer NOT NULL,
	`twitch_account_ids_json` text NOT NULL,
	`slots_json` text NOT NULL,
	`weekdays_json` text DEFAULT '[1,2,3,4,5,6,7]' NOT NULL,
	`pick_order` text DEFAULT 'oldest' NOT NULL,
	`filters_json` text DEFAULT '{}' NOT NULL,
	`format` text DEFAULT 'short' NOT NULL,
	`layout_preset_id` integer,
	`title_tpl` text NOT NULL,
	`description_tpl` text NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`category_id` text,
	`playlist_id` text,
	`made_for_kids` integer DEFAULT false NOT NULL,
	`mode` text DEFAULT 'review' NOT NULL,
	`lookahead_days` integer DEFAULT 3 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`youtube_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`layout_preset_id`) REFERENCES `layout_presets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `clips` (
	`id` text PRIMARY KEY NOT NULL,
	`twitch_account_id` integer NOT NULL,
	`title` text NOT NULL,
	`game_id` text,
	`game_name` text,
	`creator_name` text,
	`view_count` integer DEFAULT 0 NOT NULL,
	`duration_sec` real NOT NULL,
	`created_at_utc` text NOT NULL,
	`vod_offset` integer,
	`video_id` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`url` text NOT NULL,
	`thumbnail_url` text,
	`landscape_path` text,
	`portrait_path` text,
	`thumb_path` text,
	`file_size` integer,
	`download_status` text DEFAULT 'pending' NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`first_seen_utc` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`twitch_account_id`) REFERENCES `twitch_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `clips_account_created_idx` ON `clips` (`twitch_account_id`,`created_at_utc`);--> statement-breakpoint
CREATE INDEX `clips_download_status_idx` ON `clips` (`download_status`);--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at_utc` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`post_id` text,
	`account_id` integer,
	`twitch_account_id` integer,
	`data_json` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`twitch_account_id`) REFERENCES `twitch_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `event_log_at_idx` ON `event_log` (`at_utc`);--> statement-breakpoint
CREATE INDEX `event_log_post_idx` ON `event_log` (`post_id`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`box_art_url` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `layout_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`twitch_account_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`crops_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`twitch_account_id`) REFERENCES `twitch_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `post_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` text NOT NULL,
	`step` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_steps_post_step_uq` ON `post_steps` (`post_id`,`step`);--> statement-breakpoint
CREATE TABLE `posts` (
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
	`made_for_kids` integer DEFAULT false NOT NULL,
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
CREATE UNIQUE INDEX `posts_clip_account_active_uq` ON `posts` (`clip_id`,`account_id`) WHERE "posts"."clip_id" IS NOT NULL AND "posts"."status" <> 'canceled';--> statement-breakpoint
CREATE UNIQUE INDEX `posts_youtube_video_id_uq` ON `posts` (`youtube_video_id`) WHERE "posts"."youtube_video_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `posts_status_upload_after_idx` ON `posts` (`status`,`upload_after_utc`);--> statement-breakpoint
CREATE INDEX `posts_publish_at_idx` ON `posts` (`publish_at_utc`);--> statement-breakpoint
CREATE INDEX `posts_account_idx` ON `posts` (`account_id`);--> statement-breakpoint
CREATE TABLE `quota_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at_utc` text NOT NULL,
	`quota_day` text NOT NULL,
	`bucket` text NOT NULL,
	`method` text NOT NULL,
	`cost` integer NOT NULL,
	`account_id` integer,
	`post_id` text,
	`dry_run` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `quota_usage_day_idx` ON `quota_usage` (`quota_day`,`bucket`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`template_id` integer NOT NULL,
	`account_id` integer,
	`next_number` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`account_id` integer,
	`title_tpl` text NOT NULL,
	`description_tpl` text DEFAULT '' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `twitch_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`broadcaster_id` text NOT NULL,
	`login` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`editor_id` text NOT NULL,
	`auth_flow` text DEFAULT 'auth_code' NOT NULL,
	`enc_refresh_token` blob,
	`token_status` text DEFAULT 'ok' NOT NULL,
	`backfill_from_utc` text,
	`backfill_cursor_json` text,
	`last_sync_utc` text,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `twitch_accounts_broadcaster_id_unique` ON `twitch_accounts` (`broadcaster_id`);
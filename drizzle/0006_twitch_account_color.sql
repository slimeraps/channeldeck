ALTER TABLE `twitch_accounts` ADD `color` text DEFAULT '#6366f1' NOT NULL;--> statement-breakpoint
-- Existing channels get distinct colors from the palette (shared/constants/colors.ts), in the order they were connected.
UPDATE `twitch_accounts` SET `color` = CASE (SELECT count(*) FROM `twitch_accounts` AS t2 WHERE t2.`id` < `twitch_accounts`.`id`) % 8
  WHEN 0 THEN '#6366f1' WHEN 1 THEN '#f97316' WHEN 2 THEN '#22c55e' WHEN 3 THEN '#ec4899'
  WHEN 4 THEN '#06b6d4' WHEN 5 THEN '#eab308' WHEN 6 THEN '#a855f7' ELSE '#ef4444' END;

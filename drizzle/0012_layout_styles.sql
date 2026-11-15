ALTER TABLE `layout_presets` ADD `style_id` integer REFERENCES edit_styles(id) ON DELETE set null;

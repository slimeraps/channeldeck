import { sql } from 'drizzle-orm'
import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
// Relative imports only: drizzle-kit loads this file without the @shared alias.
import {
  AUTOPOST_FORMATS,
  AUTOPOST_MODES,
  DOWNLOAD_STATUSES,
  EVENT_LEVELS,
  LAYOUT_KINDS,
  LICENSES,
  MISSED_POLICIES,
  PICK_ORDERS,
  POST_SOURCES,
  POST_STATUSES,
  POST_STEPS,
  QUOTA_BUCKETS,
  STEP_STATUSES,
  TOKEN_STATUSES,
  TWITCH_AUTH_FLOWS,
  VISIBILITY_MODES
} from '../../shared/constants/enums'
import type {
  AccountDefaults,
  AutopostFilters,
  BackfillCursor,
  LayoutCrops,
  SlotTimes,
  Weekdays
} from '../../shared/types/json'

/**
 * Conventions: timestamps are UTC ISO-8601 text ending in "Z"; booleans are 0/1 integers;
 * JSON columns are text; secrets are safeStorage ciphertext blobs (never plaintext).
 */

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
const createdAt = () => text('created_at').notNull().default(nowIso)
const updatedAt = () => text('updated_at').notNull().default(nowIso)

// ---------------------------------------------------------------------------------------
// YouTube channels
// ---------------------------------------------------------------------------------------

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelId: text('channel_id').notNull().unique(),
  channelTitle: text('channel_title').notNull(),
  channelHandle: text('channel_handle'),
  avatarUrl: text('avatar_url'),
  /** Calendar color, "#rrggbb". */
  color: text('color').notNull().default('#6366f1'),
  encRefreshToken: blob('enc_refresh_token', { mode: 'buffer' }),
  tokenStatus: text('token_status', { enum: TOKEN_STATUSES }).notNull().default('ok'),
  defaultsJson: text('defaults_json', { mode: 'json' })
    .$type<AccountDefaults>()
    .notNull()
    .default(sql`'{}'`),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /**
   * Set when the channel is removed but still has post history (posts reference it).
   * Removed channels are hidden and have no token; adding the channel again restores it.
   */
  removedAt: text('removed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

// ---------------------------------------------------------------------------------------
// Twitch accounts and the clip bank
// ---------------------------------------------------------------------------------------

export const twitchAccounts = sqliteTable('twitch_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  broadcasterId: text('broadcaster_id').notNull().unique(),
  login: text('login').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  /** The user who authorized: the broadcaster or one of their editors. */
  editorId: text('editor_id').notNull(),
  authFlow: text('auth_flow', { enum: TWITCH_AUTH_FLOWS }).notNull().default('auth_code'),
  encRefreshToken: blob('enc_refresh_token', { mode: 'buffer' }),
  tokenStatus: text('token_status', { enum: TOKEN_STATUSES }).notNull().default('ok'),
  backfillFromUtc: text('backfill_from_utc'),
  backfillCursorJson: text('backfill_cursor_json', { mode: 'json' }).$type<BackfillCursor>(),
  lastSyncUtc: text('last_sync_utc'),
  syncEnabled: integer('sync_enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt()
})

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  boxArtUrl: text('box_art_url'),
  updatedAt: updatedAt()
})

export const clips = sqliteTable(
  'clips',
  {
    /** Twitch clip id. */
    id: text('id').primaryKey(),
    twitchAccountId: integer('twitch_account_id')
      .notNull()
      .references(() => twitchAccounts.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    gameId: text('game_id'),
    gameName: text('game_name'),
    creatorName: text('creator_name'),
    viewCount: integer('view_count').notNull().default(0),
    durationSec: real('duration_sec').notNull(),
    createdAtUtc: text('created_at_utc').notNull(),
    vodOffset: integer('vod_offset'),
    videoId: text('video_id'),
    isFeatured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),
    url: text('url').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    landscapePath: text('landscape_path'),
    portraitPath: text('portrait_path'),
    thumbPath: text('thumb_path'),
    fileSize: integer('file_size'),
    downloadStatus: text('download_status', { enum: DOWNLOAD_STATUSES })
      .notNull()
      .default('pending'),
    downloadAttempts: integer('download_attempts').notNull().default(0),
    downloadError: text('download_error'),
    /** Don't retry a failed download before this. */
    downloadRetryAfterUtc: text('download_retry_after_utc'),
    /** Hidden clips are never autoposted. */
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    firstSeenUtc: text('first_seen_utc').notNull().default(nowIso),
    updatedAt: updatedAt()
  },
  (t) => [
    index('clips_account_created_idx').on(t.twitchAccountId, t.createdAtUtc),
    index('clips_download_status_idx').on(t.downloadStatus)
  ]
)

export const layoutPresets = sqliteTable('layout_presets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  twitchAccountId: integer('twitch_account_id')
    .notNull()
    .references(() => twitchAccounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind', { enum: LAYOUT_KINDS }).notNull(),
  cropsJson: text('crops_json', { mode: 'json' })
    .$type<LayoutCrops>()
    .notNull()
    .default(sql`'{}'`),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

// ---------------------------------------------------------------------------------------
// Autoposting
// ---------------------------------------------------------------------------------------

export const autopostRules = sqliteTable('autopost_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  youtubeAccountId: integer('youtube_account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
  twitchAccountIdsJson: text('twitch_account_ids_json', { mode: 'json' })
    .$type<number[]>()
    .notNull(),
  slotsJson: text('slots_json', { mode: 'json' }).$type<SlotTimes>().notNull(),
  weekdaysJson: text('weekdays_json', { mode: 'json' })
    .$type<Weekdays>()
    .notNull()
    .default(sql`'[1,2,3,4,5,6,7]'`),
  pickOrder: text('pick_order', { enum: PICK_ORDERS }).notNull().default('oldest'),
  filtersJson: text('filters_json', { mode: 'json' })
    .$type<AutopostFilters>()
    .notNull()
    .default(sql`'{}'`),
  format: text('format', { enum: AUTOPOST_FORMATS }).notNull().default('short'),
  layoutPresetId: integer('layout_preset_id').references(() => layoutPresets.id, {
    onDelete: 'set null'
  }),
  titleTpl: text('title_tpl').notNull(),
  descriptionTpl: text('description_tpl').notNull(),
  tagsJson: text('tags_json', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  categoryId: text('category_id'),
  playlistId: text('playlist_id'),
  madeForKids: integer('made_for_kids', { mode: 'boolean' }).notNull().default(false),
  mode: text('mode', { enum: AUTOPOST_MODES }).notNull().default('review'),
  lookaheadDays: integer('lookahead_days').notNull().default(3),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

// ---------------------------------------------------------------------------------------
// Templates and series (manual posts)
// ---------------------------------------------------------------------------------------

export const templates = sqliteTable('templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Optional: limit the template to one channel. */
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  titleTpl: text('title_tpl').notNull(),
  descriptionTpl: text('description_tpl').notNull().default(''),
  tagsJson: text('tags_json', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

export const series = sqliteTable('series', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  templateId: integer('template_id')
    .notNull()
    .references(() => templates.id, { onDelete: 'restrict' }),
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  /** The {{n}} the next queued post in this series gets. */
  nextNumber: integer('next_number').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

// ---------------------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------------------

export const posts = sqliteTable(
  'posts',
  {
    id: text('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    source: text('source', { enum: POST_SOURCES }).notNull().default('manual'),
    clipId: text('clip_id').references(() => clips.id, { onDelete: 'restrict' }),
    ruleId: integer('rule_id').references(() => autopostRules.id, { onDelete: 'set null' }),
    /** Written only by postsRepo.transition() via nextPostStatus(). */
    status: text('status', { enum: POST_STATUSES }).notNull(),
    visibilityMode: text('visibility_mode', { enum: VISIBILITY_MODES })
      .notNull()
      .default('schedule'),
    publishAtUtc: text('publish_at_utc'),
    uploadAfterUtc: text('upload_after_utc'),
    filePath: text('file_path'),
    fileSize: integer('file_size'),
    /** File modification time in ms since epoch, to detect a replaced file. */
    fileMtime: integer('file_mtime'),
    durationSec: real('duration_sec'),
    width: integer('width'),
    height: integer('height'),
    isShort: integer('is_short', { mode: 'boolean' }).notNull().default(false),
    title: text('title').notNull().default(''),
    description: text('description').notNull().default(''),
    tagsJson: text('tags_json', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    categoryId: text('category_id'),
    playlistId: text('playlist_id'),
    thumbnailPath: text('thumbnail_path'),
    /** null until chosen; required (true/false) before a post can be queued. */
    madeForKids: integer('made_for_kids', { mode: 'boolean' }),
    notifySubscribers: integer('notify_subscribers', { mode: 'boolean' }).notNull().default(true),
    license: text('license', { enum: LICENSES }).notNull().default('youtube'),
    embeddable: integer('embeddable', { mode: 'boolean' }).notNull().default(true),
    defaultLanguage: text('default_language'),
    defaultAudioLanguage: text('default_audio_language'),
    syntheticMedia: integer('synthetic_media', { mode: 'boolean' }).notNull().default(false),
    missedPolicy: text('missed_policy', { enum: MISSED_POLICIES }).notNull().default('ask'),
    templateId: integer('template_id').references(() => templates.id, { onDelete: 'set null' }),
    seriesId: integer('series_id').references(() => series.id, { onDelete: 'set null' }),
    seriesNumber: integer('series_number'),
    youtubeVideoId: text('youtube_video_id'),
    /** 0..1 fraction of bytes sent. */
    uploadProgress: real('upload_progress').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Don't pick the post up before this (e.g. waiting_quota until midnight Pacific). */
    retryAfterUtc: text('retry_after_utc'),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    // Never post the same clip twice to the same channel. Canceled posts don't count, so
    // unscheduling before upload returns the clip to the bank (PLAN.md decision 3).
    uniqueIndex('posts_clip_account_active_uq')
      .on(t.clipId, t.accountId)
      .where(sql`${t.clipId} IS NOT NULL AND ${t.status} <> 'canceled'`),
    uniqueIndex('posts_youtube_video_id_uq')
      .on(t.youtubeVideoId)
      .where(sql`${t.youtubeVideoId} IS NOT NULL`),
    index('posts_status_upload_after_idx').on(t.status, t.uploadAfterUtc),
    index('posts_publish_at_idx').on(t.publishAtUtc),
    index('posts_account_idx').on(t.accountId)
  ]
)

export const postSteps = sqliteTable(
  'post_steps',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    step: text('step', { enum: POST_STEPS }).notNull(),
    status: text('status', { enum: STEP_STATUSES }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    updatedAt: updatedAt()
  },
  (t) => [uniqueIndex('post_steps_post_step_uq').on(t.postId, t.step)]
)

// ---------------------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------------------

export const quotaUsage = sqliteTable(
  'quota_usage',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    atUtc: text('at_utc').notNull(),
    /** The Pacific-time calendar day the call counts against, "YYYY-MM-DD". */
    quotaDay: text('quota_day').notNull(),
    bucket: text('bucket', { enum: QUOTA_BUCKETS }).notNull(),
    method: text('method').notNull(),
    cost: integer('cost').notNull(),
    accountId: integer('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    postId: text('post_id').references(() => posts.id, { onDelete: 'set null' }),
    dryRun: integer('dry_run', { mode: 'boolean' }).notNull().default(false)
  },
  (t) => [index('quota_usage_day_idx').on(t.quotaDay, t.bucket)]
)

export const eventLog = sqliteTable(
  'event_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    atUtc: text('at_utc').notNull(),
    level: text('level', { enum: EVENT_LEVELS }).notNull().default('info'),
    /** Dotted event kind, e.g. "post.status", "clips.sync". */
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    postId: text('post_id').references(() => posts.id, { onDelete: 'set null' }),
    accountId: integer('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    twitchAccountId: integer('twitch_account_id').references(() => twitchAccounts.id, {
      onDelete: 'set null'
    }),
    dataJson: text('data_json', { mode: 'json' }).$type<Record<string, unknown>>()
  },
  (t) => [index('event_log_at_idx').on(t.atUtc), index('event_log_post_idx').on(t.postId)]
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: updatedAt()
})

import { z } from 'zod'
import {
  AUTOPOST_FORMATS,
  AUTOPOST_MODES,
  LAYOUT_KINDS,
  LICENSES,
  MISSED_POLICIES,
  PICK_ORDERS,
  VISIBILITY_MODES
} from '../constants/enums'
import { accountDefaultsSchema } from './account'
import { autopostFiltersSchema, layoutCropsSchema } from './autopost'
import { settingsPatchSchema } from './settings'

/**
 * Backup file (Settings → Export backup). Plain JSON with your setup: settings, channels,
 * Twitch channels, templates, series, layouts, rules, and posts not yet on YouTube.
 * Never any sign-in token or secret: channels come back as "Needs re-auth". Things refer to
 * each other by natural keys (YouTube channel id, Twitch broadcaster id, names), not by
 * database ids, so a backup can be imported into another install.
 */

export const BACKUP_FORMAT = 1

const backupChannel = z.object({
  channelId: z.string().min(1),
  channelTitle: z.string(),
  channelHandle: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  color: z.string(),
  enabled: z.boolean(),
  defaults: accountDefaultsSchema
})

const backupTwitch = z.object({
  broadcasterId: z.string().min(1),
  login: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  color: z.string(),
  editorId: z.string(),
  authFlow: z.enum(['auth_code', 'device_code']),
  syncEnabled: z.boolean(),
  backfillFromUtc: z.string().nullable()
})

const backupTemplate = z.object({
  name: z.string().min(1),
  channelId: z.string().nullable(),
  titleTpl: z.string(),
  descriptionTpl: z.string(),
  tags: z.array(z.string())
})

const backupSeries = z.object({
  name: z.string().min(1),
  templateName: z.string(),
  channelId: z.string().nullable(),
  nextNumber: z.number().int().min(0)
})

const backupLayout = z.object({
  name: z.string().min(1),
  broadcasterId: z.string(),
  kind: z.enum(LAYOUT_KINDS),
  crops: layoutCropsSchema
})

const backupRule = z.object({
  name: z.string().min(1),
  channelId: z.string(),
  broadcasterIds: z.array(z.string()),
  slots: z.array(z.string()),
  weekdays: z.array(z.number().int()),
  pickOrder: z.enum(PICK_ORDERS),
  filters: autopostFiltersSchema,
  format: z.enum(AUTOPOST_FORMATS),
  layout: z.object({ broadcasterId: z.string(), name: z.string() }).nullable(),
  /** Added after 1.0.0: older backups don't have it. */
  useTwitchVertical: z.boolean().default(false),
  titleTpl: z.string(),
  descriptionTpl: z.string(),
  tags: z.array(z.string()),
  categoryId: z.string().nullable(),
  playlistId: z.string().nullable(),
  madeForKids: z.boolean(),
  mode: z.enum(AUTOPOST_MODES),
  lookaheadDays: z.number().int(),
  enabled: z.boolean(),
  nextNumber: z.number().int(),
  skippedClipIds: z.array(z.string())
})

const backupPost = z.object({
  channelId: z.string(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  categoryId: z.string().nullable(),
  playlistId: z.string().nullable(),
  filePath: z.string().nullable(),
  thumbnailPath: z.string().nullable(),
  madeForKids: z.boolean().nullable(),
  notifySubscribers: z.boolean(),
  license: z.enum(LICENSES),
  embeddable: z.boolean(),
  defaultLanguage: z.string().nullable(),
  defaultAudioLanguage: z.string().nullable(),
  syntheticMedia: z.boolean(),
  visibilityMode: z.enum(VISIBILITY_MODES),
  publishAtUtc: z.string().nullable(),
  missedPolicy: z.enum(MISSED_POLICIES),
  seriesName: z.string().nullable()
})

export const backupSchema = z.object({
  app: z.literal('ChannelDeck'),
  format: z.literal(BACKUP_FORMAT),
  exportedAt: z.string(),
  /** Partial so a backup from an older version (fewer settings) still imports. */
  settings: settingsPatchSchema,
  youtubeChannels: z.array(backupChannel),
  twitchChannels: z.array(backupTwitch),
  templates: z.array(backupTemplate),
  series: z.array(backupSeries),
  layouts: z.array(backupLayout),
  rules: z.array(backupRule),
  /** Posts not on YouTube yet (they come back as drafts). */
  posts: z.array(backupPost)
})
export type Backup = z.infer<typeof backupSchema>

export const importReportSchema = z.object({
  added: z.object({
    youtubeChannels: z.number().int(),
    twitchChannels: z.number().int(),
    templates: z.number().int(),
    series: z.number().int(),
    layouts: z.number().int(),
    rules: z.number().int(),
    drafts: z.number().int()
  }),
  /** Already here (same channel id / name), left as they are. */
  skipped: z.number().int()
})
export type ImportReport = z.infer<typeof importReportSchema>

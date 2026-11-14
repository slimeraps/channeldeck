import { z } from 'zod'
import { LAYOUT_KINDS } from '../constants/enums'
import {
  accountRemoveSchema,
  accountUpdateSchema,
  accountViewSchema,
  googleClientStatusSchema,
  playlistSchema,
  videoCategorySchema
} from '../schemas/account'
import {
  mediaInfoSchema,
  postDetailSchema,
  postFilterSchema,
  postInputSchema,
  postListItemSchema,
  SAVE_MODES,
  thumbnailInfoSchema
} from '../schemas/post'
import { settingsPatchSchema, settingsSchema } from '../schemas/settings'
import {
  clipIdsSchema,
  clipSearchSchema,
  clipViewSchema,
  deviceCodeEventSchema,
  twitchAccountViewSchema,
  twitchConfigSchema,
  twitchConfigUpdateSchema,
  twitchConnectSchema
} from '../schemas/twitch'
import {
  layoutInputSchema,
  layoutViewSchema,
  quotaForecastSchema,
  rulePreviewInputSchema,
  rulePreviewSchema,
  ruleSaveSchema,
  ruleViewSchema,
  sampleFrameInputSchema,
  sampleFrameSchema,
  testRenderInputSchema
} from '../schemas/autopost'
import { HEX_COLOR } from '../constants/colors'
import {
  seriesInputSchema,
  seriesViewSchema,
  templateInputSchema,
  templateViewSchema
} from '../schemas/templates'
import { importReportSchema } from '../schemas/backup'
import { analyticsInputSchema, analyticsReportSchema } from '../schemas/analytics'
import type { EventChannel, InvokeChannel } from './channels'

/**
 * The single source of truth for IPC. Every invoke channel declares the schema for its
 * input (validated in main before the handler runs) and its output. Every push event
 * declares its payload schema.
 */

const noInput = z.undefined()
const accountIdInput = z.object({ accountId: z.number().int().positive() }).strict()
const postIdInput = z.object({ id: z.uuid() }).strict()
const ruleId = z.number().int().positive()
const pathInput = z.object({ path: z.string().min(1).max(4096) }).strict()

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  platform: z.string(),
  arch: z.string(),
  isPackaged: z.boolean(),
  logsPath: z.string(),
  databasePath: z.string()
})
export type AppInfo = z.infer<typeof appInfoSchema>

export const invokeContract = {
  'app:getInfo': {
    input: noInput,
    output: appInfoSchema
  },
  'app:quota': {
    input: noInput,
    output: z.object({
      day: z.string(),
      uploadCalls: z.number().int(),
      uploadLimit: z.number().int(),
      units: z.number().int(),
      unitLimit: z.number().int(),
      resetsAtUtc: z.string()
    })
  },
  'app:storage': {
    input: noInput,
    output: z.object({
      clipsRoot: z.string(),
      accounts: z.array(
        z.object({
          id: z.number().int(),
          name: z.string(),
          color: z.string(),
          bytes: z.number(),
          downloaded: z.number().int(),
          total: z.number().int()
        })
      ),
      rendersBytes: z.number(),
      freeBytes: z.number().nullable()
    })
  },
  'backup:export': {
    input: noInput,
    output: z.union([
      z.object({ saved: z.literal(true), path: z.string() }),
      z.object({ saved: z.literal(false) })
    ])
  },
  'backup:import': {
    input: noInput,
    output: z.union([
      z.object({ imported: z.literal(true), report: importReportSchema }),
      z.object({ imported: z.literal(false) })
    ])
  },
  'app:ping': {
    input: z.object({ message: z.string().min(1).max(200) }).strict(),
    output: z.object({ reply: z.string(), receivedAt: z.iso.datetime() })
  },
  'app:openLogsFolder': {
    input: noInput,
    output: z.object({ opened: z.boolean() })
  },

  // Google client file (Settings → Import Google client file)
  'google:getClientStatus': {
    input: noInput,
    output: googleClientStatusSchema
  },
  'google:importClientFile': {
    // Main shows the file picker itself; the renderer never sends a path.
    input: noInput,
    output: z.object({ imported: z.boolean(), status: googleClientStatusSchema })
  },

  // YouTube channels
  'accounts:list': {
    input: noInput,
    output: z.array(accountViewSchema)
  },
  'accounts:add': {
    input: noInput,
    output: z.object({ added: z.array(accountViewSchema) })
  },
  'accounts:reconnect': {
    input: accountIdInput,
    output: accountViewSchema
  },
  'accounts:cancelSignIn': {
    input: noInput,
    output: z.object({ canceled: z.boolean() })
  },
  'accounts:update': {
    input: accountUpdateSchema,
    output: accountViewSchema
  },
  'accounts:refreshInfo': {
    input: accountIdInput,
    output: accountViewSchema
  },
  'accounts:removalPreview': {
    input: accountIdInput,
    output: z.object({
      pendingPosts: z.number().int(),
      inProgress: z.number().int(),
      onYouTube: z.number().int(),
      moveTargets: z.array(z.object({ id: z.number().int(), title: z.string() }))
    })
  },
  'accounts:remove': {
    input: accountRemoveSchema,
    output: z.object({
      revoked: z.boolean(),
      archived: z.boolean(),
      postsAffected: z.number().int()
    })
  },

  // Cached YouTube lookups for pickers
  'youtube:categories': {
    input: accountIdInput,
    output: z.array(videoCategorySchema)
  },
  'youtube:playlists': {
    input: z
      .object({ accountId: z.number().int().positive(), refresh: z.boolean().default(false) })
      .strict(),
    output: z.array(playlistSchema)
  },

  // Media files for the post editor
  'media:pickVideo': {
    input: noInput,
    output: mediaInfoSchema.nullable()
  },
  'media:inspectVideo': {
    // A file dropped onto the window (path from webUtils.getPathForFile in the preload).
    input: pathInput,
    output: mediaInfoSchema
  },
  'media:pickThumbnail': {
    input: noInput,
    output: thumbnailInfoSchema.nullable()
  },
  'media:inspectThumbnail': {
    input: pathInput,
    output: thumbnailInfoSchema
  },

  // Posts
  'posts:list': {
    input: postFilterSchema,
    output: z.array(postListItemSchema)
  },
  'posts:get': {
    input: postIdInput,
    output: postDetailSchema
  },
  'posts:save': {
    input: z
      .object({ id: z.uuid().optional(), input: postInputSchema, mode: z.enum(SAVE_MODES) })
      .strict(),
    output: postListItemSchema
  },
  'posts:duplicate': {
    input: z.object({ id: z.uuid(), accountId: z.number().int().positive().optional() }).strict(),
    output: postListItemSchema
  },
  'posts:cancel': {
    input: postIdInput,
    output: postListItemSchema
  },
  'posts:deleteDraft': {
    input: postIdInput,
    output: z.object({ deleted: z.boolean() })
  },
  'posts:reveal': {
    input: postIdInput,
    output: z.object({ revealed: z.boolean() })
  },
  'posts:uploadNow': {
    input: postIdInput,
    output: postListItemSchema
  },
  'posts:retry': {
    input: postIdInput,
    output: postListItemSchema
  },
  'posts:decide': {
    input: z.discriminatedUnion('action', [
      z.object({ id: z.uuid(), action: z.literal('publish_now') }).strict(),
      z
        .object({ id: z.uuid(), action: z.literal('reschedule'), publishAtUtc: z.iso.datetime() })
        .strict()
    ]),
    output: postListItemSchema
  },
  'posts:reschedule': {
    input: z.object({ id: z.uuid(), publishAtUtc: z.iso.datetime() }).strict(),
    output: postListItemSchema
  },
  'posts:keepPrivate': {
    input: postIdInput,
    output: postListItemSchema
  },
  'posts:deleteFromYouTube': {
    input: postIdInput,
    output: postListItemSchema
  },
  'posts:syncStatus': {
    input: noInput,
    output: z.object({
      checked: z.number().int(),
      changed: z.number().int(),
      skippedChannels: z.number().int()
    })
  },

  // Settings
  'settings:get': {
    input: noInput,
    output: z.object({ settings: settingsSchema, uploadsPausedUntil: z.string().nullable() })
  },
  'settings:update': {
    input: settingsPatchSchema.strict(),
    output: settingsSchema
  },
  'settings:chooseClipsFolder': {
    // Main shows the folder picker itself.
    input: noInput,
    output: z.object({ changed: z.boolean(), clipsRoot: z.string() })
  },

  // Twitch
  'twitch:getConfig': { input: noInput, output: twitchConfigSchema },
  'twitch:setConfig': { input: twitchConfigUpdateSchema, output: twitchConfigSchema },
  'twitch:list': { input: noInput, output: z.array(twitchAccountViewSchema) },
  'twitch:connect': { input: twitchConnectSchema, output: twitchAccountViewSchema },
  'twitch:cancelConnect': { input: noInput, output: z.object({ canceled: z.boolean() }) },
  'twitch:reconnect': {
    input: z.object({ id: z.number().int().positive() }).strict(),
    output: twitchAccountViewSchema
  },
  'twitch:update': {
    input: z
      .object({
        id: z.number().int().positive(),
        syncEnabled: z.boolean().optional(),
        color: z.string().regex(HEX_COLOR).optional()
      })
      .strict(),
    output: twitchAccountViewSchema
  },
  'twitch:syncNow': {
    input: z.object({ id: z.number().int().positive() }).strict(),
    output: z.object({ started: z.boolean() })
  },
  'twitch:remove': {
    input: z.object({ id: z.number().int().positive() }).strict(),
    output: z.object({ removedClips: z.number().int() })
  },

  // Clip bank
  'clips:search': {
    input: clipSearchSchema,
    output: z.object({
      items: z.array(clipViewSchema),
      total: z.number().int(),
      games: z.array(z.object({ id: z.string(), name: z.string() }))
    })
  },
  'clips:get': {
    input: z.object({ id: z.string().min(1).max(100) }).strict(),
    output: clipViewSchema
  },
  'clips:setHidden': {
    input: clipIdsSchema.extend({ hidden: z.boolean() }),
    output: z.object({ updated: z.number().int() })
  },
  'clips:redownload': { input: clipIdsSchema, output: z.object({ queued: z.number().int() }) },
  'clips:deleteLocal': { input: clipIdsSchema, output: z.object({ deleted: z.number().int() }) },
  'clips:addToChannel': {
    input: clipIdsSchema.extend({ accountId: z.number().int().positive() }),
    output: z.object({ created: z.number().int(), skipped: z.array(z.string()) })
  },
  'posts:approve': { input: postIdInput, output: postListItemSchema },
  'posts:renderVertical': {
    input: z
      .object({
        sourcePath: z.string().min(1),
        kind: z.enum(LAYOUT_KINDS),
        presetId: z.number().int().positive().nullable()
      })
      .strict(),
    output: mediaInfoSchema
  },
  'autopost:list': { input: noInput, output: z.array(ruleViewSchema) },
  'autopost:save': { input: ruleSaveSchema, output: ruleViewSchema },
  'autopost:delete': {
    input: z.object({ id: ruleId, cancelUpcoming: z.boolean() }).strict(),
    output: z.object({ canceled: z.number().int() })
  },
  'autopost:setEnabled': {
    input: z.object({ id: ruleId, enabled: z.boolean() }).strict(),
    output: ruleViewSchema
  },
  'autopost:preview': { input: rulePreviewInputSchema, output: rulePreviewSchema },
  'autopost:approveAll': {
    input: z.object({ id: ruleId }).strict(),
    output: z.object({ approved: z.number().int() })
  },
  'autopost:forecast': { input: noInput, output: quotaForecastSchema },
  'autopost:swapCandidates': {
    input: postIdInput,
    output: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        thumbUrl: z.string().nullable(),
        viewCount: z.number().int(),
        durationSec: z.number(),
        createdAtUtc: z.string(),
        gameName: z.string().nullable(),
        needsRender: z.boolean()
      })
    )
  },
  'autopost:swapClip': {
    input: z.object({ id: z.uuid(), clipId: z.string().min(1).optional() }).strict(),
    output: z.object({ postId: z.string(), title: z.string() })
  },
  'layouts:list': { input: noInput, output: z.array(layoutViewSchema) },
  'layouts:save': {
    input: z.object({ id: ruleId.optional(), input: layoutInputSchema }).strict(),
    output: layoutViewSchema
  },
  'layouts:delete': {
    input: z.object({ id: ruleId }).strict(),
    output: z.object({ ok: z.literal(true) })
  },
  'layouts:sampleFrame': { input: sampleFrameInputSchema, output: sampleFrameSchema },
  'templates:list': { input: noInput, output: z.array(templateViewSchema) },
  'templates:save': {
    input: z.object({ id: ruleId.optional(), input: templateInputSchema }).strict(),
    output: templateViewSchema
  },
  'templates:delete': {
    input: z.object({ id: ruleId }).strict(),
    output: z.object({ ok: z.literal(true) })
  },
  'series:list': { input: noInput, output: z.array(seriesViewSchema) },
  'series:save': {
    input: z.object({ id: ruleId.optional(), input: seriesInputSchema }).strict(),
    output: seriesViewSchema
  },
  'series:delete': {
    input: z.object({ id: ruleId }).strict(),
    output: z.object({ ok: z.literal(true) })
  },
  'layouts:testRender': {
    input: testRenderInputSchema,
    output: z.object({ url: z.string(), path: z.string() })
  },
  // YouTube Analytics (its own quota, not the Data API's 10,000 units)
  'analytics:report': { input: analyticsInputSchema, output: analyticsReportSchema }
} as const satisfies Record<InvokeChannel, { input: z.ZodType; output: z.ZodType }>

export const eventContract = {
  'ui:newPost': z.undefined(),
  /** Channels were added, removed, or changed status (e.g. needs re-auth). */
  'accounts:changed': z.undefined(),
  /** Posts were created, changed status, or were deleted. */
  'posts:changed': z.undefined(),
  /** Twitch accounts or the clip bank changed (sync progress, downloads, connect). */
  'twitch:changed': z.undefined(),
  'templates:changed': z.undefined(),
  /** Device Code sign-in: show this code to type at twitch.tv/activate. */
  'twitch:deviceCode': deviceCodeEventSchema,
  /** Live upload progress (not every byte; throttled in main). */
  'posts:progress': z.object({
    postId: z.string(),
    sentBytes: z.number().nonnegative(),
    totalBytes: z.number().nonnegative()
  })
} as const satisfies Record<EventChannel, z.ZodType>

export type InvokeInput<C extends InvokeChannel> = z.input<(typeof invokeContract)[C]['input']>
export type InvokeOutput<C extends InvokeChannel> = z.output<(typeof invokeContract)[C]['output']>
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContract)[C]>

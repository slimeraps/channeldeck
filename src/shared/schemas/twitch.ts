import { z } from 'zod'
import { PICK_ORDERS, TOKEN_STATUSES } from '../constants/enums'

export const twitchConfigSchema = z.object({
  clientId: z.string().nullable(),
  hasSecret: z.boolean(),
  redirectUri: z.string()
})
export type TwitchConfig = z.infer<typeof twitchConfigSchema>

export const twitchConfigUpdateSchema = z
  .object({
    clientId: z.string().trim().min(1).max(100),
    /** undefined = keep the stored secret; null = remove it (use Device Code instead). */
    clientSecret: z.string().trim().min(1).max(200).nullable().optional()
  })
  .strict()

export const CONNECT_MODES = ['broadcaster', 'editor'] as const

export const twitchConnectSchema = z
  .object({
    mode: z.enum(CONNECT_MODES),
    /** The channel to connect, when signing in as one of its editors. */
    channelLogin: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{3,25}$/, 'Enter the channel name as in twitch.tv/<name>')
      .optional(),
    /** Backfill from this date; null = from the channel's creation. */
    backfillFromUtc: z.iso.datetime().nullable()
  })
  .strict()
  .refine((v) => v.mode === 'broadcaster' || v.channelLogin, {
    message: 'Enter the channel you are an editor of',
    path: ['channelLogin']
  })

export const twitchAccountViewSchema = z.object({
  id: z.number().int(),
  broadcasterId: z.string(),
  login: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  /** "#rrggbb", shown on its clips, tabs and autopost rules. */
  color: z.string(),
  /** Signed in as an editor rather than the broadcaster. */
  viaEditor: z.boolean(),
  authFlow: z.enum(['auth_code', 'device_code']),
  tokenStatus: z.enum(TOKEN_STATUSES),
  syncEnabled: z.boolean(),
  lastSyncUtc: z.string().nullable(),
  backfillFromUtc: z.string().nullable(),
  backfill: z
    .object({
      windowsDone: z.number().int(),
      windowsTotal: z.number().int(),
      nextWindowStartUtc: z.string()
    })
    .nullable(),
  syncing: z.boolean(),
  stats: z.object({
    total: z.number().int(),
    downloaded: z.number().int(),
    pendingDownloads: z.number().int(),
    failedDownloads: z.number().int(),
    bytesOnDisk: z.number()
  })
})
export type TwitchAccountView = z.infer<typeof twitchAccountViewSchema>

export const deviceCodeEventSchema = z.object({
  userCode: z.string(),
  verificationUri: z.string(),
  expiresAtUtc: z.string()
})

export const clipSearchSchema = z
  .object({
    /** Which Twitch channels; leave out for all of them. */
    twitchAccountIds: z.array(z.number().int().positive()).max(50).optional(),
    sort: z.enum(PICK_ORDERS),
    gameId: z.string().max(40).optional(),
    minDurationSec: z.number().min(0).max(3600).optional(),
    maxDurationSec: z.number().min(0).max(3600).optional(),
    minViews: z.number().int().min(0).optional(),
    featuredOnly: z.boolean().optional(),
    posted: z.enum(['posted', 'unposted']).optional(),
    fromUtc: z.iso.datetime().optional(),
    toUtc: z.iso.datetime().optional(),
    titleSearch: z.string().max(100).optional(),
    includeHidden: z.boolean().optional(),
    limit: z.number().int().min(1).max(200),
    offset: z.number().int().min(0)
  })
  .strict()
export type ClipSearchInput = z.infer<typeof clipSearchSchema>

export const clipViewSchema = z.object({
  id: z.string(),
  /** Local files (null when not on disk), for posting the clip. */
  landscapePath: z.string().nullable(),
  portraitPath: z.string().nullable(),
  twitchAccountId: z.number().int(),
  twitchName: z.string(),
  twitchColor: z.string(),
  title: z.string(),
  gameName: z.string().nullable(),
  creatorName: z.string().nullable(),
  viewCount: z.number().int(),
  durationSec: z.number(),
  createdAtUtc: z.string(),
  isFeatured: z.boolean(),
  hidden: z.boolean(),
  url: z.string(),
  /** Local thumbnail if downloaded, else Twitch's. */
  thumbnailUrl: z.string().nullable(),
  landscapeUrl: z.string().nullable(),
  portraitUrl: z.string().nullable(),
  downloadStatus: z.string(),
  downloadError: z.string().nullable(),
  /** Each post this clip became (not canceled). */
  posts: z.array(
    z.object({
      postId: z.string(),
      status: z.string(),
      channelTitle: z.string(),
      channelColor: z.string(),
      youtubeVideoId: z.string().nullable()
    })
  )
})
export type ClipView = z.infer<typeof clipViewSchema>

export const clipIdsSchema = z
  .object({ ids: z.array(z.string().min(1).max(100)).min(1).max(500) })
  .strict()

import { z } from 'zod'
import { HEX_COLOR } from '../constants/colors'
import { LICENSES, TOKEN_STATUSES } from '../constants/enums'
import type { AccountDefaults } from '../types/json'

/** Per-channel defaults for new posts (stored in accounts.defaults_json). */
export const accountDefaultsSchema = z
  .object({
    categoryId: z.string().min(1).max(10).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    playlistId: z.string().min(1).max(64).optional(),
    madeForKids: z.boolean().optional(),
    defaultLanguage: z.string().min(2).max(20).optional(),
    defaultAudioLanguage: z.string().min(2).max(20).optional(),
    license: z.enum(LICENSES).optional(),
    descriptionFooter: z
      .string()
      .max(2000)
      .refine((s) => !/[<>]/.test(s), 'YouTube does not allow < or > in descriptions')
      .optional()
  })
  .strict() satisfies z.ZodType<AccountDefaults>

/** A YouTube channel as the renderer sees it. Never includes tokens. */
export const accountViewSchema = z.object({
  id: z.number().int(),
  channelId: z.string(),
  channelTitle: z.string(),
  channelHandle: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  color: z.string().regex(HEX_COLOR),
  tokenStatus: z.enum(TOKEN_STATUSES),
  enabled: z.boolean(),
  defaults: accountDefaultsSchema,
  createdAt: z.string(),
  counts: z.object({ pending: z.number().int(), scheduled: z.number().int() }),
  nextPublishAtUtc: z.string().nullable()
})
export type AccountView = z.infer<typeof accountViewSchema>

export const accountUpdateSchema = z
  .object({
    accountId: z.number().int().positive(),
    color: z.string().regex(HEX_COLOR).optional(),
    enabled: z.boolean().optional(),
    defaults: accountDefaultsSchema.optional()
  })
  .strict()

export const REMOVE_POSTS_ACTIONS = ['cancel', 'move', 'drafts'] as const
export type RemovePostsAction = (typeof REMOVE_POSTS_ACTIONS)[number]

export const accountRemoveSchema = z
  .object({
    accountId: z.number().int().positive(),
    postsAction: z.enum(REMOVE_POSTS_ACTIONS),
    moveToAccountId: z.number().int().positive().optional()
  })
  .strict()
  .refine((v) => v.postsAction !== 'move' || v.moveToAccountId !== undefined, {
    message: 'Pick a channel to move the posts to',
    path: ['moveToAccountId']
  })

export const googleClientStatusSchema = z.object({
  configured: z.boolean(),
  projectId: z.string().nullable(),
  clientIdHint: z.string().nullable(),
  /** Set when a file is present but can't be read. */
  problem: z.string().nullable()
})
export type GoogleClientStatus = z.infer<typeof googleClientStatusSchema>

export const videoCategorySchema = z.object({
  id: z.string(),
  title: z.string(),
  assignable: z.boolean()
})

export const playlistSchema = z.object({
  id: z.string(),
  title: z.string(),
  itemCount: z.number().int(),
  privacy: z.string().nullable()
})

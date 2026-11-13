import { z } from 'zod'
import {
  accountRemoveSchema,
  accountUpdateSchema,
  accountViewSchema,
  googleClientStatusSchema,
  playlistSchema,
  videoCategorySchema
} from '../schemas/account'
import type { EventChannel, InvokeChannel } from './channels'

/**
 * The single source of truth for IPC. Every invoke channel declares the schema for its
 * input (validated in main before the handler runs) and its output. Every push event
 * declares its payload schema.
 */

const noInput = z.undefined()
const accountIdInput = z.object({ accountId: z.number().int().positive() }).strict()

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
  }
} as const satisfies Record<InvokeChannel, { input: z.ZodType; output: z.ZodType }>

export const eventContract = {
  'ui:newPost': z.undefined(),
  /** Channels were added, removed, or changed status (e.g. needs re-auth). */
  'accounts:changed': z.undefined()
} as const satisfies Record<EventChannel, z.ZodType>

export type InvokeInput<C extends InvokeChannel> = z.input<(typeof invokeContract)[C]['input']>
export type InvokeOutput<C extends InvokeChannel> = z.output<(typeof invokeContract)[C]['output']>
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContract)[C]>

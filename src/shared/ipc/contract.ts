import { z } from 'zod'
import type { EventChannel, InvokeChannel } from './channels'

/**
 * The single source of truth for IPC. Every invoke channel declares the schema for its
 * input (validated in main before the handler runs) and its output. Every push event
 * declares its payload schema.
 */

const noInput = z.undefined()

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
  }
} as const satisfies Record<InvokeChannel, { input: z.ZodType; output: z.ZodType }>

export const eventContract = {
  'ui:newPost': z.undefined()
} as const satisfies Record<EventChannel, z.ZodType>

export type InvokeInput<C extends InvokeChannel> = z.input<(typeof invokeContract)[C]['input']>
export type InvokeOutput<C extends InvokeChannel> = z.output<(typeof invokeContract)[C]['output']>
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContract)[C]>

import type { InvokeChannel } from '@shared/ipc/channels'
import { invokeContract, type InvokeInput, type InvokeOutput } from '@shared/ipc/contract'
import { ipcErr, ipcOk, type IpcIssue, type IpcResult } from '@shared/ipc/result'
import type { z } from 'zod'
import { isUserFacing } from '../errors'
import { type AppOrigin, isAppUrl } from '../security'

/**
 * Electron-free core of the IPC layer, so it can be unit-tested: validates the raw payload
 * against the channel's schema, runs the handler, and turns every outcome into an
 * IpcResult. Handler errors are logged in full but only a generic message reaches the
 * renderer.
 */

export type InvokeHandler<C extends InvokeChannel> = (
  input: InvokeOutputOfInput<C>
) => Promise<InvokeOutput<C>> | InvokeOutput<C>

/** The parsed (output) type of a channel's input schema. */
export type InvokeOutputOfInput<C extends InvokeChannel> = z.output<
  (typeof invokeContract)[C]['input']
>

export interface InvokeLogger {
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export function toIssues(error: z.ZodError): IpcIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message
  }))
}

export function createInvokeHandler<C extends InvokeChannel>(
  channel: C,
  handler: InvokeHandler<C>,
  logger: InvokeLogger
): (raw: unknown) => Promise<IpcResult<InvokeOutput<C>>> {
  const schema = invokeContract[channel].input
  return async (raw) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      const issues = toIssues(parsed.error)
      logger.warn(`[ipc] ${channel}: rejected invalid input`, issues)
      return ipcErr('invalid_input', `Invalid input for ${channel}`, issues)
    }
    try {
      const data = await handler(parsed.data as InvokeOutputOfInput<C>)
      return ipcOk(data)
    } catch (error) {
      if (isUserFacing(error)) {
        logger.warn(`[ipc] ${channel}: ${error.message}`)
        return ipcErr('rejected', error.message)
      }
      logger.error(`[ipc] ${channel}: handler failed`, error)
      return ipcErr('internal', `${channel} failed. Details are in the log.`)
    }
  }
}

export interface GatedEvent {
  senderFrame?: { url: string } | null
}

/**
 * Adds the sender check in front of createInvokeHandler: calls from any frame that isn't
 * our own renderer are refused before the payload is even looked at.
 */
export function createGatedHandler<C extends InvokeChannel>(
  channel: C,
  handler: InvokeHandler<C>,
  logger: InvokeLogger,
  getOrigin: () => AppOrigin | null
): (event: GatedEvent, raw: unknown) => Promise<IpcResult<InvokeOutput<C>>> {
  const run = createInvokeHandler(channel, handler, logger)
  return async (event, raw) => {
    const senderUrl = event.senderFrame?.url ?? ''
    const origin = getOrigin()
    if (!origin || !isAppUrl(senderUrl, origin)) {
      logger.warn(`[ipc] ${channel}: blocked call from untrusted sender`, senderUrl)
      return ipcErr('forbidden', 'This sender may not call ChannelDeck IPC.')
    }
    return run(raw)
  }
}

// Re-exported for handler modules.
export type { InvokeInput, InvokeOutput }

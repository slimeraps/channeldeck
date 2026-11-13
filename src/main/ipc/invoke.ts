import type { InvokeChannel } from '@shared/ipc/channels'
import { invokeContract, type InvokeInput, type InvokeOutput } from '@shared/ipc/contract'
import { ipcErr, ipcOk, type IpcIssue, type IpcResult } from '@shared/ipc/result'
import type { z } from 'zod'

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
      logger.error(`[ipc] ${channel}: handler failed`, error)
      return ipcErr('internal', `${channel} failed. Details are in the log.`)
    }
  }
}

// Re-exported for handler modules.
export type { InvokeInput, InvokeOutput }

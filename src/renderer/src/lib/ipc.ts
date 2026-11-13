import type { EventChannel, InvokeChannel } from '@shared/ipc/channels'
import type { EventPayload, InvokeInput, InvokeOutput } from '@shared/ipc/contract'
import type { IpcErrorBody, IpcResult } from '@shared/ipc/result'

/** Thrown in the renderer when main answers with an error result. */
export class IpcError extends Error {
  readonly code: IpcErrorBody['code']
  readonly issues: IpcErrorBody['issues']

  constructor(body: IpcErrorBody) {
    super(body.message)
    this.name = 'IpcError'
    this.code = body.code
    this.issues = body.issues
  }
}

export function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.data
  throw new IpcError(result.error)
}

/** Typed call into main. Resolves with the data or throws IpcError (TanStack Query friendly). */
export async function invoke<C extends InvokeChannel>(
  channel: C,
  ...input: InvokeInput<C> extends undefined ? [] : [InvokeInput<C>]
): Promise<InvokeOutput<C>> {
  return unwrap(await window.api.invoke(channel, ...input))
}

/** Subscribes to a push event from main. Returns the unsubscribe function. */
export function onEvent<C extends EventChannel>(
  channel: C,
  listener: (payload: EventPayload<C>) => void
): () => void {
  return window.api.on(channel, listener)
}

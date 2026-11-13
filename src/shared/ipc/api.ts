import type { EventChannel, InvokeChannel } from './channels'
import type { EventPayload, InvokeInput, InvokeOutput } from './contract'
import type { IpcResult } from './result'

/**
 * The only thing the preload exposes to the renderer, as `window.api`.
 * `invoke` resolves to an IpcResult; the renderer's `lib/ipc.ts` unwraps it.
 */
export interface ChannelDeckApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...input: InvokeInput<C> extends undefined ? [] : [InvokeInput<C>]
  ): Promise<IpcResult<InvokeOutput<C>>>
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void
}

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ChannelDeckApi } from '@shared/ipc/api'
import { isEventChannel, isInvokeChannel } from '@shared/ipc/channels'
import { ipcErr } from '@shared/ipc/result'

/**
 * Sandboxed preload. Exposes exactly one object, `window.api`, with two functions. The
 * renderer never sees ipcRenderer, Node, or Electron. Only channels listed in
 * shared/ipc/channels.ts get through; main validates every payload again.
 */
export const api: ChannelDeckApi = {
  invoke(channel, ...input) {
    if (!isInvokeChannel(channel)) {
      return Promise.resolve(ipcErr('unknown_channel', `Unknown IPC channel: ${String(channel)}`))
    }
    return ipcRenderer.invoke(channel, input[0])
  },

  on(channel, listener) {
    if (!isEventChannel(channel)) {
      throw new Error(`Unknown IPC event: ${String(channel)}`)
    }
    // Strip the Electron event object so the renderer only receives the payload.
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      listener(payload as Parameters<typeof listener>[0])
    }
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', Object.freeze(api))

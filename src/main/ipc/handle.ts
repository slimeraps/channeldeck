import { type BrowserWindow, ipcMain } from 'electron'
import type { EventChannel, InvokeChannel } from '@shared/ipc/channels'
import { eventContract, type EventPayload } from '@shared/ipc/contract'
import { logger } from '../logger'
import type { AppOrigin } from '../security'
import { createGatedHandler, type InvokeHandler } from './invoke'

let appOrigin: AppOrigin | null = null

/** Must be called once, before any `handle()`, with where our renderer is served from. */
export function setIpcOrigin(origin: AppOrigin): void {
  appOrigin = origin
}

/**
 * The only way to register an invoke channel. Rejects calls from any frame that isn't our
 * renderer, validates the payload with the channel's zod schema, and wraps the result.
 */
export function handle<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
  ipcMain.handle(
    channel,
    createGatedHandler(channel, handler, logger, () => appOrigin)
  )
}

/** Sends a typed push event to the renderer after validating its payload. */
export function sendEvent<C extends EventChannel>(
  window: BrowserWindow | null,
  channel: C,
  payload: EventPayload<C>
): void {
  if (!window || window.isDestroyed()) return
  const parsed = eventContract[channel].safeParse(payload)
  if (!parsed.success) {
    logger.error(`[ipc] refused to send invalid ${channel} event`, parsed.error.issues)
    return
  }
  window.webContents.send(channel, parsed.data)
}

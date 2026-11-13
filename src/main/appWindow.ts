import type { BrowserWindow } from 'electron'
import type { EventChannel } from '@shared/ipc/channels'
import type { EventPayload } from '@shared/ipc/contract'
import { sendEvent } from './ipc/handle'

/** The current main window, so services can push events without importing index.ts. */
let current: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow | null): void {
  current = window
}

export function getMainWindow(): BrowserWindow | null {
  return current && !current.isDestroyed() ? current : null
}

const listeners: ((channel: EventChannel) => void)[] = []

/** Main-process listeners for events sent to the renderer (e.g. the tray on posts:changed). */
export function onEmit(listener: (channel: EventChannel) => void): void {
  listeners.push(listener)
}

export function emitToRenderer<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
  sendEvent(getMainWindow(), channel, payload)
  for (const listener of listeners) listener(channel)
}

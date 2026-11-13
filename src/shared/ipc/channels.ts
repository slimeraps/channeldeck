/**
 * IPC channel names, kept free of runtime dependencies so the sandboxed preload can
 * bundle this file without pulling in zod. The schemas for each channel live in
 * `contract.ts`; a test checks the two lists match.
 */

/** Renderer → main request/response channels (ipcRenderer.invoke). */
export const INVOKE_CHANNELS = [
  'app:getInfo',
  'app:ping',
  'app:openLogsFolder',
  'google:getClientStatus',
  'google:importClientFile',
  'accounts:list',
  'accounts:add',
  'accounts:reconnect',
  'accounts:cancelSignIn',
  'accounts:update',
  'accounts:refreshInfo',
  'accounts:removalPreview',
  'accounts:remove',
  'youtube:categories',
  'youtube:playlists',
  'media:pickVideo',
  'media:inspectVideo',
  'media:pickThumbnail',
  'media:inspectThumbnail',
  'posts:list',
  'posts:get',
  'posts:save',
  'posts:duplicate',
  'posts:cancel',
  'posts:deleteDraft',
  'posts:reveal',
  'posts:uploadNow',
  'posts:retry',
  'settings:get',
  'settings:update'
] as const
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

/** Main → renderer push events (webContents.send). */
export const EVENT_CHANNELS = [
  'ui:newPost',
  'accounts:changed',
  'posts:changed',
  'posts:progress'
] as const
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && (INVOKE_CHANNELS as readonly string[]).includes(value)
}

export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && (EVENT_CHANNELS as readonly string[]).includes(value)
}

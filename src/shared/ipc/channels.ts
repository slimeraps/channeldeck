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
  'posts:decide',
  'posts:reschedule',
  'posts:keepPrivate',
  'posts:deleteFromYouTube',
  'posts:syncStatus',
  'settings:get',
  'settings:update',
  'settings:chooseClipsFolder',
  'twitch:getConfig',
  'twitch:setConfig',
  'twitch:list',
  'twitch:connect',
  'twitch:cancelConnect',
  'twitch:reconnect',
  'twitch:update',
  'twitch:syncNow',
  'twitch:remove',
  'clips:search',
  'clips:get',
  'clips:setHidden',
  'clips:redownload',
  'clips:deleteLocal',
  'clips:addToChannel',
  'posts:approve',
  'autopost:list',
  'autopost:save',
  'autopost:delete',
  'autopost:setEnabled',
  'autopost:preview',
  'autopost:approveAll',
  'autopost:forecast',
  'layouts:list',
  'layouts:save',
  'layouts:delete',
  'layouts:sampleFrame',
  'layouts:testRender',
  'templates:list',
  'templates:save',
  'templates:delete',
  'series:list',
  'series:save',
  'series:delete',
  'autopost:swapCandidates',
  'autopost:swapClip',
  'app:quota',
  'app:storage',
  'backup:export',
  'backup:import',
  'posts:renderVertical'
] as const
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

/** Main → renderer push events (webContents.send). */
export const EVENT_CHANNELS = [
  'ui:newPost',
  'accounts:changed',
  'posts:changed',
  'posts:progress',
  'twitch:changed',
  'twitch:deviceCode',
  'templates:changed'
] as const
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && (INVOKE_CHANNELS as readonly string[]).includes(value)
}

export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && (EVENT_CHANNELS as readonly string[]).includes(value)
}

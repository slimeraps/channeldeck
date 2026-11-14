import { join } from 'node:path'
import { app, shell } from 'electron'
import type { OAuth2Client } from 'google-auth-library'
import { emitToRenderer } from '../appWindow'
import { getRepos } from '../db'
import { createClientConfigStore } from '../google/clientConfig'
import type { YouTubeApi } from '../google/youtube'
import { demoAnalyticsApi, demoVideoTitles } from '../screenshots'
import { logger } from '../logger'
import { createMediaAccess, type MediaAccess } from '../media/access'
import { probeVideo } from '../media/ffprobe'
import { notify } from '../notify'
import { secrets } from '../secrets'
import { isSafeExternalUrl } from '../security'
import { grabFrame, renderVertical } from '../media/ffmpeg'
import { type AnalyticsService, createAnalyticsService } from './analytics'
import { createAutopostService, type AutopostService } from './autopost'
import { createClipsService, type ClipsService } from './clips'
import { createLayoutsService, type LayoutsService } from './layouts'
import { type BackupService, createBackupService } from './backup'
import { createStatusService, type StatusService } from './status'
import { createTemplatesService, type TemplatesService } from './templates'
import { createPostsService, type PostsService } from './posts'
import { createTwitchAccountsService, type TwitchAccountsService } from './twitchAccounts'
import { createYouTubeAccountsService, type YouTubeAccountsService } from './youtubeAccounts'

let youtubeAccounts: YouTubeAccountsService | null = null
let posts: PostsService | null = null
let mediaAccess: MediaAccess | null = null
let kickHook: (() => void) | null = null
let twitchAccounts: TwitchAccountsService | null = null
let clips: ClipsService | null = null
let syncingProbe: ((accountId: number) => boolean) | null = null
let autopost: AutopostService | null = null
let layouts: LayoutsService | null = null
let templates: TemplatesService | null = null
let status: StatusService | null = null
let backup: BackupService | null = null
let analytics: AnalyticsService | null = null

/** Lets the Twitch view show "syncing…" without importing the job runner. */
export function setSyncingProbe(fn: (accountId: number) => boolean): void {
  syncingProbe = fn
}

/** Lets services poke the job runner without importing it (avoids an import cycle). */
export function setKickJobs(fn: () => void): void {
  kickHook = fn
}

/** Creates the app's services. Call once, after initDatabase(). */
export function initServices(): void {
  const repos = getRepos()
  const demo = !app.isPackaged && Boolean(process.env['CHANNELDECK_SCREENSHOTS'])

  mediaAccess = createMediaAccess({
    // The clip bank (and renders inside it) is always previewable.
    roots: () => {
      const clipsRoot = repos.settings.getKey('clipsRoot')
      return [clipsRoot, join(clipsRoot, '_renders')]
    },
    isReferenced: (path) => repos.posts.referencesFile(path)
  })

  youtubeAccounts = createYouTubeAccountsService({
    repos,
    secrets,
    clientConfig: createClientConfigStore(app.getPath('userData')),
    openExternal: async (url) => {
      if (!isSafeExternalUrl(url)) throw new Error('Refusing to open a non-https sign-in URL')
      await shell.openExternal(url)
    },
    notify,
    emitChanged: () => emitToRenderer('accounts:changed', undefined),
    logger
  })

  posts = createPostsService({
    repos,
    probe: probeVideo,
    media: mediaAccess,
    emitChanged: () => emitToRenderer('posts:changed', undefined),
    kickJobs: () => kickHook?.(),
    withApi: (accountId, fn) => getYouTubeAccounts().withApi(accountId, fn),
    renderVertical: ({ spec, video, output }) => renderVertical({ spec, video, output })
  })

  twitchAccounts = createTwitchAccountsService({
    repos,
    secrets,
    openExternal: async (url) => {
      if (!isSafeExternalUrl(url)) throw new Error('Refusing to open a non-https sign-in URL')
      await shell.openExternal(url)
    },
    notify,
    emitChanged: () => emitToRenderer('twitch:changed', undefined),
    emitDeviceCode: (info) => emitToRenderer('twitch:deviceCode', info),
    kickJobs: () => kickHook?.(),
    logger,
    isSyncing: (id) => syncingProbe?.(id) ?? false
  })

  clips = createClipsService({
    repos,
    media: mediaAccess,
    probe: probeVideo,
    emitChanged: () => emitToRenderer('twitch:changed', undefined),
    emitPostsChanged: () => emitToRenderer('posts:changed', undefined),
    kickJobs: () => kickHook?.()
  })

  autopost = createAutopostService({
    repos,
    probe: probeVideo,
    media: mediaAccess,
    notify,
    emitPostsChanged: () => emitToRenderer('posts:changed', undefined),
    kickJobs: () => kickHook?.(),
    logger
  })

  status = createStatusService({ repos })
  backup = createBackupService({ repos })
  analytics = demo
    ? createAnalyticsService({
        // Screenshot mode: made-up numbers, no Google calls.
        repos,
        withAuth: (_id, fn) => fn({} as OAuth2Client),
        withApi: (_id, fn) =>
          fn({ videoTitles: async (ids: string[]) => demoVideoTitles(ids) } as YouTubeApi),
        createApi: demoAnalyticsApi,
        logger
      })
    : createAnalyticsService({
        repos,
        withAuth: (accountId, fn) => getYouTubeAccounts().withAuth(accountId, fn),
        withApi: (accountId, fn) => getYouTubeAccounts().withApi(accountId, fn),
        logger
      })

  templates = createTemplatesService({
    repos,
    emitChanged: () => emitToRenderer('templates:changed', undefined)
  })

  layouts = createLayoutsService({
    repos,
    media: mediaAccess,
    probe: probeVideo,
    grabFrame,
    renderTest: ({ sourcePath, kind, crops, video, output, maxSeconds }) =>
      renderVertical({
        spec: { sourcePath, kind, crops },
        video,
        output,
        maxSeconds
      })
  })
}

export function getAnalytics(): AnalyticsService {
  if (!analytics) throw new Error('Services not initialized')
  return analytics
}

export function getBackup(): BackupService {
  if (!backup) throw new Error('Services not initialized')
  return backup
}

export function getStatus(): StatusService {
  if (!status) throw new Error('Services not initialized')
  return status
}

export function getTemplates(): TemplatesService {
  if (!templates) throw new Error('Services not initialized')
  return templates
}

export function getAutopost(): AutopostService {
  if (!autopost) throw new Error('Services not initialized')
  return autopost
}

export function getLayouts(): LayoutsService {
  if (!layouts) throw new Error('Services not initialized')
  return layouts
}

export function getTwitchAccounts(): TwitchAccountsService {
  if (!twitchAccounts) throw new Error('Services not initialized')
  return twitchAccounts
}

export function getClips(): ClipsService {
  if (!clips) throw new Error('Services not initialized')
  return clips
}

export function getYouTubeAccounts(): YouTubeAccountsService {
  if (!youtubeAccounts) throw new Error('Services not initialized')
  return youtubeAccounts
}

export function getPosts(): PostsService {
  if (!posts) throw new Error('Services not initialized')
  return posts
}

export function getMediaAccess(): MediaAccess {
  if (!mediaAccess) throw new Error('Services not initialized')
  return mediaAccess
}

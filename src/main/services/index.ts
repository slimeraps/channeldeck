import { join } from 'node:path'
import { app, shell } from 'electron'
import { emitToRenderer } from '../appWindow'
import { getRepos } from '../db'
import { createClientConfigStore } from '../google/clientConfig'
import { logger } from '../logger'
import { createMediaAccess, type MediaAccess } from '../media/access'
import { probeVideo } from '../media/ffprobe'
import { notify } from '../notify'
import { secrets } from '../secrets'
import { isSafeExternalUrl } from '../security'
import { createClipsService, type ClipsService } from './clips'
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
    withApi: (accountId, fn) => getYouTubeAccounts().withApi(accountId, fn)
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

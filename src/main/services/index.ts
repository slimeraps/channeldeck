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
import { createPostsService, type PostsService } from './posts'
import { createYouTubeAccountsService, type YouTubeAccountsService } from './youtubeAccounts'

let youtubeAccounts: YouTubeAccountsService | null = null
let posts: PostsService | null = null
let mediaAccess: MediaAccess | null = null
let kickHook: (() => void) | null = null

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

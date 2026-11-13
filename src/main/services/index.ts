import { app, shell } from 'electron'
import { emitToRenderer } from '../appWindow'
import { getRepos } from '../db'
import { createClientConfigStore } from '../google/clientConfig'
import { logger } from '../logger'
import { notify } from '../notify'
import { secrets } from '../secrets'
import { isSafeExternalUrl } from '../security'
import { createYouTubeAccountsService, type YouTubeAccountsService } from './youtubeAccounts'

let youtubeAccounts: YouTubeAccountsService | null = null

/** Creates the app's services. Call once, after initDatabase(). */
export function initServices(): void {
  youtubeAccounts = createYouTubeAccountsService({
    repos: getRepos(),
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
}

export function getYouTubeAccounts(): YouTubeAccountsService {
  if (!youtubeAccounts) throw new Error('Services not initialized')
  return youtubeAccounts
}

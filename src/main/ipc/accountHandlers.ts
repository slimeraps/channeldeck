import { readFile } from 'node:fs/promises'
import { dialog } from 'electron'
import { getMainWindow } from '../appWindow'
import { UserFacingError } from '../errors'
import { getYouTubeAccounts } from '../services'
import { handle } from './handle'

const MAX_CLIENT_FILE_BYTES = 64 * 1024

export function registerAccountHandlers(): void {
  const accounts = (): ReturnType<typeof getYouTubeAccounts> => getYouTubeAccounts()

  handle('google:getClientStatus', () => accounts().getClientStatus())

  handle('google:importClientFile', async () => {
    const window = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Import Google client file',
      message: 'Choose the client_secret_….json you downloaded for your Desktop app OAuth client.',
      properties: ['openFile'],
      filters: [{ name: 'Google client file', extensions: ['json'] }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    if (result.canceled || !path) {
      return { imported: false, status: accounts().getClientStatus() }
    }
    const text = await readFile(path, 'utf8')
    if (Buffer.byteLength(text) > MAX_CLIENT_FILE_BYTES) {
      throw new UserFacingError('That file is too large to be a Google client file.')
    }
    return { imported: true, status: accounts().importClientFile(text) }
  })

  handle('accounts:list', () => accounts().list())
  handle('accounts:add', async () => ({ added: await accounts().addChannel() }))
  handle('accounts:reconnect', ({ accountId }) => accounts().reconnect(accountId))
  handle('accounts:cancelSignIn', () => ({ canceled: accounts().cancelSignIn() }))
  handle('accounts:update', (input) => accounts().update(input))
  handle('accounts:refreshInfo', ({ accountId }) => accounts().refreshInfo(accountId))
  handle('accounts:removalPreview', ({ accountId }) => accounts().removalPreview(accountId))
  handle('accounts:remove', (input) => accounts().remove(input))
  handle('youtube:categories', ({ accountId }) => accounts().categories(accountId))
  handle('youtube:playlists', ({ accountId, refresh }) => accounts().playlists(accountId, refresh))
}

import { dialog } from 'electron'
import { getMainWindow } from '../appWindow'
import { getRepos } from '../db'
import { getClips, getTwitchAccounts } from '../services'
import { handle } from './handle'

export function registerTwitchHandlers(): void {
  const twitch = (): ReturnType<typeof getTwitchAccounts> => getTwitchAccounts()
  const clips = (): ReturnType<typeof getClips> => getClips()

  handle('twitch:getConfig', () => twitch().getConfig())
  handle('twitch:setConfig', (input) => twitch().setConfig(input))
  handle('twitch:list', () => twitch().list())
  handle('twitch:connect', (input) => twitch().connect(input))
  handle('twitch:cancelConnect', () => ({ canceled: twitch().cancelConnect() }))
  handle('twitch:reconnect', ({ id }) => twitch().reconnect(id))
  handle('twitch:update', ({ id, syncEnabled }) => twitch().update(id, { syncEnabled }))
  handle('twitch:syncNow', ({ id }) => {
    twitch().syncNow(id)
    return { started: true }
  })
  handle('twitch:remove', ({ id }) => twitch().remove(id))

  handle('clips:search', (input) => clips().search(input))
  handle('clips:setHidden', ({ ids, hidden }) => clips().setHidden(ids, hidden))
  handle('clips:redownload', ({ ids }) => clips().redownload(ids))
  handle('clips:deleteLocal', ({ ids }) => clips().deleteLocal(ids))
  handle('clips:addToChannel', ({ ids, accountId }) => clips().addToChannel(ids, accountId))

  handle('settings:chooseClipsFolder', async () => {
    const repos = getRepos()
    const current = repos.settings.getKey('clipsRoot')
    const window = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose the clip folder',
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    if (result.canceled || !path) return { changed: false, clipsRoot: current }
    repos.settings.update({ clipsRoot: path })
    return { changed: true, clipsRoot: path }
  })
}

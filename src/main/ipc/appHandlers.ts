import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog, shell } from 'electron'
import { getMainWindow } from '../appWindow'
import { UserFacingError } from '../errors'
import { APP_NAME } from '@shared/constants/app'
import { databasePath } from '../db'
import { getBackup, getStatus } from '../services'
import { handle } from './handle'

export function registerAppHandlers(): void {
  handle('app:getInfo', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    logsPath: app.getPath('logs'),
    databasePath: databasePath()
  }))

  handle('backup:export', async () => {
    const backup = getBackup().exportBackup()
    const options: Electron.SaveDialogOptions = {
      title: 'Export ChannelDeck backup',
      defaultPath: join(
        app.getPath('documents'),
        `ChannelDeck backup ${backup.exportedAt.slice(0, 10)}.json`
      ),
      filters: [{ name: 'ChannelDeck backup', extensions: ['json'] }]
    }
    const window = getMainWindow()
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false as const }
    await writeFile(result.filePath, `${JSON.stringify(backup, null, 2)}\n`, { mode: 0o600 })
    return { saved: true as const, path: result.filePath }
  })

  handle('backup:import', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Import ChannelDeck backup',
      properties: ['openFile'],
      filters: [{ name: 'ChannelDeck backup', extensions: ['json'] }]
    }
    const window = getMainWindow()
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    if (result.canceled || !path) return { imported: false as const }
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      throw new UserFacingError(
        "That file isn't valid JSON, so it can't be a ChannelDeck backup.",
        {
          cause: error
        }
      )
    }
    return { imported: true as const, report: getBackup().importBackup(raw) }
  })

  handle('app:quota', () => getStatus().quotaToday())
  handle('app:storage', () => getStatus().storage())

  handle('app:ping', ({ message }) => ({
    reply: `pong: ${message}`,
    receivedAt: new Date().toISOString()
  }))

  handle('app:openLogsFolder', async () => {
    // shell.openPath resolves to an error string, or '' on success.
    const error = await shell.openPath(app.getPath('logs'))
    if (error) throw new Error(`Could not open logs folder: ${error}`)
    return { opened: true }
  })
}

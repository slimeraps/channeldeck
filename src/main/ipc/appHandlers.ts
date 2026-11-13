import { app, shell } from 'electron'
import { APP_NAME } from '@shared/constants/app'
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
    logsPath: app.getPath('logs')
  }))

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

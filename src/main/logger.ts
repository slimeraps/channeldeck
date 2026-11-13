import { join } from 'node:path'
import { app } from 'electron'
import log from 'electron-log/main'
import { redact } from './redact'

/**
 * The only logger the main process uses. Every message passes through `redact` before
 * reaching any transport, so tokens and secrets never land in ~/Library/Logs/ChannelDeck.
 */
export const logger = log

let initialized = false

export function initLogger(): void {
  if (initialized) return
  initialized = true

  // app.getPath('logs') is ~/Library/Logs/ChannelDeck on macOS (app name set in index.ts).
  log.transports.file.resolvePathFn = () => join(app.getPath('logs'), 'main.log')
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.console.level = app.isPackaged ? false : 'debug'

  log.hooks.push((message) => ({ ...message, data: message.data.map((item) => redact(item)) }))

  log.errorHandler.startCatching({ showDialog: false })
}

import { app, type BrowserWindow, dialog, Menu, session } from 'electron'
import { APP_NAME } from '@shared/constants/app'
import { emitToRenderer, setMainWindow } from './appWindow'
import { closeDatabase, databasePath, initDatabase } from './db'
import { registerAccountHandlers } from './ipc/accountHandlers'
import { registerAppHandlers } from './ipc/appHandlers'
import { setIpcOrigin } from './ipc/handle'
import { registerPostHandlers } from './ipc/postHandlers'
import { registerTwitchHandlers } from './ipc/twitchHandlers'
import { kickJobs, startJobs, stopJobs } from './jobs'
import { initLogger, logger } from './logger'
import { handleMediaProtocol, registerMediaScheme } from './media/protocol'
import { buildAppMenu } from './menu'
import type { AppOrigin } from './security'
import { getMediaAccess, getYouTubeAccounts, initServices, setKickJobs } from './services'
import { createMainWindow } from './window'

// Name first: it decides ~/Library/Application Support/ChannelDeck and ~/Library/Logs/ChannelDeck.
app.setName(APP_NAME)
initLogger()

// Every renderer is sandboxed, even ones we don't create directly.
app.enableSandbox()

// cdmedia:// (local video/thumbnail previews) must be registered before 'ready'.
registerMediaScheme()

const origin: AppOrigin = {
  devServerUrl: !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
}
let mainWindow: BrowserWindow | null = null

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow(origin)
    setMainWindow(mainWindow)
    mainWindow.on('closed', () => {
      mainWindow = null
      setMainWindow(null)
    })
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function hardenSessions(): void {
  // The renderer never needs camera, mic, geolocation, notifications etc.
  // (native notifications are sent from main).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    logger.warn('[security] denied permission request', permission)
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

async function start(): Promise<void> {
  await app.whenReady()
  logger.info(
    `[app] ${APP_NAME} ${app.getVersion()} starting (electron ${process.versions.electron})`
  )
  hardenSessions()

  try {
    const repos = initDatabase()
    repos.eventLog.write({ kind: 'app.start', message: `${APP_NAME} ${app.getVersion()} started` })
  } catch (error) {
    logger.error('[db] could not open the database', error)
    dialog.showErrorBox(
      `${APP_NAME} can't open its database`,
      `${databasePath()}\n\n${error instanceof Error ? error.message : String(error)}\n\n` +
        'Details are in ~/Library/Logs/ChannelDeck/main.log.'
    )
    app.exit(1)
    return
  }

  initServices()
  handleMediaProtocol(() => getMediaAccess().policy())
  setIpcOrigin(origin)
  registerAppHandlers()
  registerAccountHandlers()
  registerPostHandlers()
  registerTwitchHandlers()

  Menu.setApplicationMenu(
    buildAppMenu({
      isDev: !app.isPackaged,
      onNewPost: () => {
        showMainWindow()
        emitToRenderer('ui:newPost', undefined)
      }
    })
  )

  showMainWindow()
  app.on('activate', () => showMainWindow())

  // Confirm every channel's Google sign-in still works (1 quota unit each). Expired ones
  // get flagged "Needs re-auth" with a notification.
  void getYouTubeAccounts().checkAll()

  // Uploads (and later: clip sync, downloads, planner, status sync).
  setKickJobs(kickJobs)
  startJobs()
}

// One running copy only: two would race on the database and the job runner.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  // Phase 9 adds the tray and close-to-tray; until then quit when the window closes
  // (except on macOS, where apps conventionally stay in the Dock).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Stop jobs first so in-flight uploads mark themselves "interrupted", then close the DB.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void stopJobs()
      .catch((error: unknown) => logger.error('[jobs] stop failed', error))
      .finally(() => app.quit())
  })
  app.on('will-quit', () => closeDatabase())

  start().catch((error: unknown) => {
    logger.error('[app] failed to start', error)
    app.exit(1)
  })
}

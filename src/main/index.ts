import { join } from 'node:path'
import { app, type BrowserWindow, dialog, Menu, session } from 'electron'
import { APP_NAME } from '@shared/constants/app'
import { emitToRenderer, onEmit, setMainWindow } from './appWindow'
import { closeDatabase, databasePath, getRepos, initDatabase } from './db'
import { registerAccountHandlers } from './ipc/accountHandlers'
import { registerAppHandlers } from './ipc/appHandlers'
import { setIpcOrigin } from './ipc/handle'
import { registerPostHandlers } from './ipc/postHandlers'
import { registerAutopostHandlers } from './ipc/autopostHandlers'
import { registerTwitchHandlers } from './ipc/twitchHandlers'
import { jobsPaused, kickJobs, setJobsPaused, startJobs, stopJobs } from './jobs'
import { applyLoginItem, openedAtLogin } from './loginItem'
import { notify } from './notify'
import { createTray, destroyTray, refreshTray } from './tray'
import { initLogger, logger } from './logger'
import { handleMediaProtocol, registerMediaScheme } from './media/protocol'
import { buildAppMenu } from './menu'
import type { AppOrigin } from './security'
import {
  getMediaAccess,
  getTwitchAccounts,
  getYouTubeAccounts,
  initServices,
  setKickJobs
} from './services'
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
/** Set once a real quit starts (Cmd+Q, tray Quit), so closing the window can't hide it then. */
let quitting = false

/** Keep in menu bar: closing the window hides it; uploads and syncs keep running. */
function keepInTray(): boolean {
  try {
    return getRepos().settings.getKey('keepInTray')
  } catch {
    return false
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow(origin)
    setMainWindow(mainWindow)
    mainWindow.on('close', (event) => {
      if (quitting || !keepInTray()) return
      event.preventDefault()
      mainWindow?.hide()
    })
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
  // Packaged builds take the icon from the bundle; from source, show it in the Dock too.
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock?.setIcon(join(__dirname, '../../resources/icon.png'))
  }

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
  registerAutopostHandlers()

  Menu.setApplicationMenu(
    buildAppMenu({
      isDev: !app.isPackaged,
      onNewPost: () => {
        showMainWindow()
        emitToRenderer('ui:newPost', undefined)
      }
    })
  )

  // Started at login with "keep in menu bar" on: stay in the menu bar until clicked.
  if (!(openedAtLogin() && keepInTray())) showMainWindow()
  app.on('activate', () => showMainWindow())
  applyLoginItem(getRepos().settings.getKey('launchAtLogin'))

  // Confirm every channel's Google sign-in still works (1 quota unit each). Expired ones
  // get flagged "Needs re-auth" with a notification.
  void getYouTubeAccounts().checkAll()

  // Uploads (and later: clip sync, downloads, planner, status sync).
  setKickJobs(kickJobs)
  startJobs()

  createTray({
    repos: getRepos(),
    onOpen: () => showMainWindow(),
    onSyncNow: () => {
      const twitch = getTwitchAccounts()
      const ready = twitch.list().filter((a) => a.tokenStatus === 'ok' && a.syncEnabled)
      for (const account of ready) twitch.syncNow(account.id)
      notify(
        'Syncing clips',
        ready.length
          ? `Checking ${ready.length} Twitch channel(s) for new clips.`
          : 'No Twitch channels are ready to sync.'
      )
    },
    isPaused: jobsPaused,
    setPaused: (paused) => {
      setJobsPaused(paused)
      notify(
        paused ? 'Jobs paused' : 'Jobs resumed',
        paused
          ? 'No uploads, syncs or downloads start until you resume (or restart ChannelDeck).'
          : 'Uploads, syncs and downloads carry on.'
      )
    },
    onQuit: () => app.quit()
  })
  onEmit((channel) => {
    if (channel === 'posts:changed') refreshTray()
  })
}

// One running copy only: two would race on the database and the job runner.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  // Keep in menu bar off: closing the window quits (the window only hides when it's on).
  app.on('window-all-closed', () => {
    if (!keepInTray()) app.quit()
  })

  // Stop jobs first so in-flight uploads mark themselves "interrupted", then close the DB.
  let stopping = false
  app.on('before-quit', (event) => {
    quitting = true
    if (stopping) return
    stopping = true
    event.preventDefault()
    void stopJobs()
      .catch((error: unknown) => logger.error('[jobs] stop failed', error))
      .finally(() => app.quit())
  })
  app.on('will-quit', () => {
    destroyTray()
    closeDatabase()
  })

  start().catch((error: unknown) => {
    logger.error('[app] failed to start', error)
    app.exit(1)
  })
}

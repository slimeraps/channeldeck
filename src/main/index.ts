import { app, type BrowserWindow, Menu, session } from 'electron'
import { APP_NAME } from '@shared/constants/app'
import { registerAppHandlers } from './ipc/appHandlers'
import { sendEvent, setIpcOrigin } from './ipc/handle'
import { initLogger, logger } from './logger'
import { buildAppMenu } from './menu'
import type { AppOrigin } from './security'
import { createMainWindow } from './window'

// Name first: it decides ~/Library/Application Support/ChannelDeck and ~/Library/Logs/ChannelDeck.
app.setName(APP_NAME)
initLogger()

// Every renderer is sandboxed, even ones we don't create directly.
app.enableSandbox()

const origin: AppOrigin = {
  devServerUrl: !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
}
let mainWindow: BrowserWindow | null = null

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow(origin)
    mainWindow.on('closed', () => {
      mainWindow = null
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
  setIpcOrigin(origin)
  registerAppHandlers()

  Menu.setApplicationMenu(
    buildAppMenu({
      isDev: !app.isPackaged,
      onNewPost: () => {
        showMainWindow()
        sendEvent(mainWindow, 'ui:newPost', undefined)
      }
    })
  )

  showMainWindow()
  app.on('activate', () => showMainWindow())
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

  start().catch((error: unknown) => {
    logger.error('[app] failed to start', error)
    app.exit(1)
  })
}

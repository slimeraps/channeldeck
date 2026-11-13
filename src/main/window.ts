import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { logger } from './logger'
import { type AppOrigin, isAllowedNavigation, isSafeExternalUrl } from './security'

export function createMainWindow(origin: AppOrigin): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'ChannelDeck',
    backgroundColor: '#09090b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: true
    }
  })

  window.once('ready-to-show', () => window.show())

  // window.open / target=_blank: never a new Electron window. https links go to the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    else logger.warn('[window] blocked window.open', url)
    return { action: 'deny' }
  })

  // Block navigating the app window anywhere but our own renderer.
  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, origin)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    else logger.warn('[window] blocked navigation', url)
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, origin)) {
      event.preventDefault()
      logger.warn('[window] blocked redirect', url)
    }
  })

  if (origin.devServerUrl) void window.loadURL(origin.devServerUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  return window
}

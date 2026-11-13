import { app } from 'electron'
import { logger } from './logger'

/**
 * Launch at login. Only the installed app registers itself: in development the binary is
 * Electron itself, which shouldn't end up in your Login Items.
 */
export function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) {
    logger.info(`[app] launch at login ${enabled ? 'on' : 'off'} (applies in the installed app)`)
    return
  }
  app.setLoginItemSettings({ openAtLogin: enabled })
}

/** Started by macOS at login (then it can stay in the menu bar instead of opening a window). */
export function openedAtLogin(): boolean {
  return app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin === true
}

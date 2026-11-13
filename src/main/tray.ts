import { join } from 'node:path'
import { Menu, nativeImage, Tray } from 'electron'
import { APP_NAME } from '@shared/constants/app'
import type { Repos } from './db/repos'
import { formatNext, trayStatus } from './domain/trayStatus'

/**
 * The menu bar icon: pending count next to it, next publish time in the menu, plus Open,
 * Sync clips now, Pause jobs and Quit. Refreshed when posts change and every 30 seconds.
 */

export interface TrayDeps {
  repos: Repos
  onOpen: () => void
  onSyncNow: () => void
  isPaused: () => boolean
  setPaused: (paused: boolean) => void
  onQuit: () => void
}

let tray: Tray | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null
let deps: TrayDeps | null = null

function iconPath(): string {
  // out/main → ../../resources in dev; inside app.asar when packaged (nativeImage reads asar).
  return join(__dirname, '../../resources/trayTemplate.png')
}

export function refreshTray(): void {
  if (!tray || !deps) return
  const d = deps
  const now = new Date()
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const status = trayStatus(d.repos.posts.list({}), now)
  const paused = d.isPaused()

  tray.setTitle(status.pending > 0 ? ` ${status.pending}` : '', { fontType: 'monospacedDigit' })
  const nextLine = status.next
    ? `Next: ${formatNext(status.next.atUtc, now, zone)}`
    : 'Nothing scheduled'
  tray.setToolTip(
    `${APP_NAME}: ${status.pending} pending${status.next ? ` · ${nextLine}` : ''}${paused ? ' · paused' : ''}`
  )
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `${status.pending} post${status.pending === 1 ? '' : 's'} pending${status.needsYou ? ` (${status.needsYou} need you)` : ''}`,
        enabled: false
      },
      { label: nextLine, enabled: false },
      ...(status.next ? [{ label: `   ${status.next.title.slice(0, 60)}`, enabled: false }] : []),
      ...(paused ? [{ label: 'Jobs are paused', enabled: false }] : []),
      { type: 'separator' },
      { label: `Open ${APP_NAME}`, click: () => d.onOpen() },
      { label: 'Sync clips now', click: () => d.onSyncNow() },
      {
        label: 'Pause jobs',
        type: 'checkbox',
        checked: paused,
        toolTip: 'No uploads, syncs or downloads start until you resume or restart ChannelDeck.',
        click: () => {
          d.setPaused(!paused)
          refreshTray()
        }
      },
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, accelerator: 'Command+Q', click: () => d.onQuit() }
    ])
  )
}

export function createTray(trayDeps: TrayDeps): void {
  if (tray) return
  deps = trayDeps
  const image = nativeImage.createFromPath(iconPath())
  image.setTemplateImage(true)
  tray = new Tray(image)
  refreshTray()
  refreshTimer = setInterval(refreshTray, 30_000)
}

export function destroyTray(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  tray?.destroy()
  tray = null
}

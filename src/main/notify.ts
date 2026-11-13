import { Notification } from 'electron'
import { logger } from './logger'

/** Native macOS notification. Fails quietly (logged) if notifications aren't available. */
export function notify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return
    new Notification({ title, body }).show()
  } catch (error) {
    logger.warn('[notify] could not show notification', error)
  }
}

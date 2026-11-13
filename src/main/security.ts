/**
 * Pure URL rules for the window: which pages the app itself may load, which senders may
 * call IPC, and which links may be handed to the system browser. No Electron imports.
 */

export interface AppOrigin {
  /** The electron-vite dev server URL in development, undefined when packaged. */
  devServerUrl: string | undefined
}

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** True for URLs that belong to our own renderer (dev server or bundled file). */
export function isAppUrl(url: string, origin: AppOrigin): boolean {
  const parsed = parse(url)
  if (!parsed) return false
  if (origin.devServerUrl) {
    const dev = parse(origin.devServerUrl)
    return dev !== null && parsed.origin === dev.origin
  }
  return parsed.protocol === 'file:' && parsed.pathname.endsWith('/renderer/index.html')
}

/** In-window navigation is only allowed to our own renderer (e.g. a dev reload). */
export function isAllowedNavigation(url: string, origin: AppOrigin): boolean {
  return isAppUrl(url, origin)
}

/** Only https links (YouTube Studio, Twitch, docs) may open in the system browser. */
export function isSafeExternalUrl(url: string): boolean {
  const parsed = parse(url)
  return (
    parsed !== null &&
    parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === ''
  )
}

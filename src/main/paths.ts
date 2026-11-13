import { join } from 'node:path'
import { app } from 'electron'

/**
 * A file from ./resources. In the installed app they're unpacked from app.asar
 * (electron-builder asarUnpack), so native APIs like nativeImage and the Dock can read them.
 */
export function resourcePath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', name)
    : join(app.getAppPath(), 'resources', name)
}

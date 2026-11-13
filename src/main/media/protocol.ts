import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { protocol } from 'electron'
import { logger } from '../logger'
import { createMediaHandler } from './mediaHandler'
import { MEDIA_SCHEME, type MediaPolicy } from './mediaUrl'

/** Must run before app 'ready'. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** Serves allowed local media with HTTP range support, so <video> can seek. */
export function handleMediaProtocol(getPolicy: () => MediaPolicy): void {
  protocol.handle(
    MEDIA_SCHEME,
    createMediaHandler({ getPolicy, stat, realpath, createReadStream, logger })
  )
}

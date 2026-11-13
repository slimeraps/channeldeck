import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { logger } from '../logger'
import {
  contentTypeFor,
  MEDIA_SCHEME,
  type MediaPolicy,
  parseRange,
  pathFromMediaUrl,
  isServable,
  resolveServable
} from './mediaUrl'

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
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const path = pathFromMediaUrl(request.url)
    if (!path || !isServable(path, getPolicy())) {
      logger.warn('[media] refused', path ?? request.url)
      return new Response('Not allowed', { status: 403 })
    }
    let size: number
    try {
      const info = await stat(path)
      if (!info.isFile()) return new Response('Not found', { status: 404 })
      size = info.size
    } catch {
      return new Response('Not found', { status: 404 })
    }
    // Resolve symlinks: a link inside a root must not lead out of it.
    const realPath = await resolveServable(path, getPolicy(), realpath)
    if (!realPath) {
      logger.warn('[media] refused (outside allowed folders after resolving links)', path)
      return new Response('Not allowed', { status: 403 })
    }

    const headers: Record<string, string> = {
      'Content-Type': contentTypeFor(path),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }
    const range = parseRange(request.headers.get('range'), size)
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const { start, end } = range ?? { start: 0, end: size - 1 }
    const body = Readable.toWeb(
      createReadStream(realPath, { start, end })
    ) as ReadableStream<Uint8Array>
    headers['Content-Length'] = String(end - start + 1)
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    return new Response(body, { status: range ? 206 : 200, headers })
  })
}

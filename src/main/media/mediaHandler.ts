import { Readable } from 'node:stream'
import {
  contentTypeFor,
  type MediaPolicy,
  parseRange,
  pathFromMediaUrl,
  isServable,
  resolveServable
} from './mediaUrl'

/**
 * Electron-free core of the cdmedia:// protocol, so it can be unit-tested: everything
 * that touches the disk or the logger is injected. protocol.ts wires in the real ones.
 */
export interface MediaHandlerDeps {
  getPolicy: () => MediaPolicy
  stat: (path: string) => Promise<{ isFile(): boolean; size: number }>
  realpath: (path: string) => Promise<string>
  createReadStream: (path: string, range: { start: number; end: number }) => Readable
  logger: { warn(...args: unknown[]): void }
}

export function createMediaHandler(
  deps: MediaHandlerDeps
): (request: Request) => Promise<Response> {
  const { getPolicy, stat, realpath, createReadStream, logger } = deps
  return async (request) => {
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
  }
}

import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createMediaHandler, type MediaHandlerDeps } from './mediaHandler'
import { mediaUrl } from './mediaUrl'

const root = resolve('cdmedia-handler-test', 'clips')
const file = join(root, 'me', 'a.mp4')
const content = Buffer.from('0123456789') // 10 bytes

function setup(overrides: Partial<MediaHandlerDeps> = {}) {
  const logger = { warn: vi.fn() }
  const createReadStream = vi.fn((_path: string, range: { start: number; end: number }) =>
    Readable.from([content.subarray(range.start, range.end + 1)])
  )
  const deps: MediaHandlerDeps = {
    getPolicy: () => ({ roots: [root], isAllowedFile: () => false }),
    stat: () => Promise.resolve({ isFile: () => true, size: content.length }),
    realpath: (p) => Promise.resolve(p),
    createReadStream,
    logger,
    ...overrides
  }
  const handler = createMediaHandler(deps)
  const get = (path: string, range?: string): Promise<Response> =>
    handler(new Request(mediaUrl(path), range ? { headers: { range } } : undefined))
  return { get, handler, logger, createReadStream }
}

describe('createMediaHandler', () => {
  it('200: serves the whole file', async () => {
    const { get, createReadStream } = setup()
    const res = await get(file)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Length')).toBe('10')
    expect(res.headers.get('Content-Range')).toBeNull()
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('0123456789')
    expect(createReadStream).toHaveBeenCalledWith(file, { start: 0, end: 9 })
  })

  it('206: serves the requested byte range', async () => {
    const { get, createReadStream } = setup()
    const res = await get(file, 'bytes=2-5')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10')
    expect(res.headers.get('Content-Length')).toBe('4')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('2345')
    expect(createReadStream).toHaveBeenCalledWith(file, { start: 2, end: 5 })
  })

  it('reads from the resolved real path, not the link', async () => {
    const real = join(root, 'me', 'real.mp4')
    const { get, createReadStream } = setup({
      realpath: (p) => Promise.resolve(p === file ? real : p)
    })
    expect((await get(file)).status).toBe(200)
    expect(createReadStream).toHaveBeenCalledWith(real, { start: 0, end: 9 })
  })

  it('403: refuses a URL that is not a cdmedia file URL', async () => {
    const { handler, logger } = setup()
    const res = await handler(new Request('cdmedia://other/abc'))
    expect(res.status).toBe(403)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('403: refuses a path outside the allowed folders without touching the disk', async () => {
    const stat = vi.fn()
    const { get, logger } = setup({ stat })
    const res = await get(join(resolve('cdmedia-handler-test'), 'other', 'a.mp4'))
    expect(res.status).toBe(403)
    expect(stat).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('403: refuses a link that resolves outside the allowed folders', async () => {
    const outside = join(resolve('cdmedia-handler-test'), 'private', 'secret.mp4')
    const { get, createReadStream, logger } = setup({
      realpath: (p) => Promise.resolve(p === file ? outside : p)
    })
    const res = await get(file)
    expect(res.status).toBe(403)
    expect(createReadStream).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('404: file is missing', async () => {
    const { get } = setup({ stat: () => Promise.reject(new Error('ENOENT')) })
    expect((await get(file)).status).toBe(404)
  })

  it('404: path is not a regular file', async () => {
    const { get } = setup({ stat: () => Promise.resolve({ isFile: () => false, size: 0 }) })
    expect((await get(file)).status).toBe(404)
  })

  it('416: range starts past the end of the file', async () => {
    const { get, createReadStream } = setup()
    const res = await get(file, 'bytes=10-')
    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe('bytes */10')
    expect(createReadStream).not.toHaveBeenCalled()
  })

  it('416: malformed range header', async () => {
    const { get } = setup()
    expect((await get(file, 'bytes=0-1,5-6')).status).toBe(416)
  })
})

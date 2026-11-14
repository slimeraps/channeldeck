import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMediaHandler } from './mediaHandler'
import { mediaUrl } from './mediaUrl'

/**
 * The same handler on a real disk with real symlinks (mediaHandler.test.ts uses fakes):
 * the checks from harden-media-protocol's "Mac by hand" list.
 */

let base: string
let clips: string
let linkedClips: string
let outside: string

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'cdmedia-fs-'))
  clips = join(base, 'clips')
  outside = join(base, 'outside')
  mkdirSync(join(clips, 'me'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(clips, 'me', 'real.mp4'), Buffer.from('0123456789'))
  writeFileSync(join(outside, 'secret.mp4'), Buffer.from('do not serve'))
  // A link inside the clip folder that leads out of it.
  symlinkSync(join(outside, 'secret.mp4'), join(clips, 'me', 'escape.mp4'))
  // A link to a system file, named like a video.
  symlinkSync('/etc/hosts', join(clips, 'me', 'hosts.mp4'))
  // The whole clip folder reached through a symlink (e.g. a folder on another drive).
  linkedClips = join(base, 'linked-clips')
  symlinkSync(clips, linkedClips)
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

function handlerFor(root: string) {
  const handler = createMediaHandler({
    getPolicy: () => ({ roots: [root], isAllowedFile: () => false }),
    stat,
    realpath,
    createReadStream,
    logger: { warn: vi.fn() }
  })
  return (path: string, range?: string) =>
    handler(new Request(mediaUrl(path), range ? { headers: { range } } : undefined))
}

describe('cdmedia on a real disk', () => {
  it('plays and seeks in a normal clip', async () => {
    const get = handlerFor(clips)
    const full = await get(join(clips, 'me', 'real.mp4'))
    expect(full.status).toBe(200)
    expect(await full.text()).toBe('0123456789')
    const part = await get(join(clips, 'me', 'real.mp4'), 'bytes=2-5')
    expect(part.status).toBe(206)
    expect(await part.text()).toBe('2345')
  })

  it('refuses symlinks that lead outside the clip folder', async () => {
    const get = handlerFor(clips)
    expect((await get(join(clips, 'me', 'escape.mp4'))).status).toBe(403)
    expect((await get(join(clips, 'me', 'hosts.mp4'))).status).toBe(403)
  })

  it('still plays when the clip folder itself is a symlink', async () => {
    const get = handlerFor(linkedClips)
    const res = await get(join(linkedClips, 'me', 'real.mp4'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('0123456789')
  })
})

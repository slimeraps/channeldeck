import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  contentTypeFor,
  isServable,
  mediaUrl,
  parseRange,
  pathFromMediaUrl,
  resolveServable
} from './mediaUrl'

describe('media URLs', () => {
  it('round-trips paths with spaces and unicode', () => {
    const path = '/Users/cody/Movies/MW4 Day 9 🔥/clip.mp4'
    const url = mediaUrl(path)
    expect(url.startsWith('cdmedia://file/')).toBe(true)
    expect(pathFromMediaUrl(url)).toBe(path)
  })

  it('rejects other schemes, hosts, relative paths and junk', () => {
    expect(pathFromMediaUrl('file:///etc/passwd')).toBeNull()
    expect(pathFromMediaUrl('cdmedia://other/abc')).toBeNull()
    expect(
      pathFromMediaUrl(`cdmedia://file/${Buffer.from('relative/x.mp4').toString('base64url')}`)
    ).toBeNull()
    expect(pathFromMediaUrl('cdmedia://file/%2e%2e')).toBeNull()
  })
})

describe('isServable', () => {
  const policy = {
    roots: ['/Users/cody/Movies/ChannelDeck/Clips/'],
    isAllowedFile: (p: string) => p === '/Users/cody/Desktop/upload.mov'
  }

  it('serves media inside allowed roots or explicitly allowed files', () => {
    expect(isServable('/Users/cody/Movies/ChannelDeck/Clips/me/2026/a.mp4', policy)).toBe(true)
    expect(isServable('/Users/cody/Desktop/upload.mov', policy)).toBe(true)
  })

  it('refuses everything else', () => {
    expect(isServable('/Users/cody/Desktop/other.mov', policy)).toBe(false)
    expect(isServable('/Users/cody/Movies/ChannelDeck/Clips/../../secret.mp4', policy)).toBe(false)
    expect(isServable('/Users/cody/Movies/ChannelDeck/ClipsEvil/a.mp4', policy)).toBe(false)
    expect(isServable('/Users/cody/Movies/ChannelDeck/Clips/me/notes.txt', policy)).toBe(false)
    expect(isServable('/Users/cody/Movies/ChannelDeck/Clips/me/data.db', policy)).toBe(false)
  })
})

describe('resolveServable (symlinks)', () => {
  const base = resolve('cdmedia-test')
  const root = join(base, 'clips')
  const outside = join(base, 'private')
  const policy = {
    roots: [root],
    isAllowedFile: (p: string) => p === join(base, 'picked.mov')
  }
  /** Fake realpath: paths in `links` resolve to their target, everything else to itself. */
  const fakeRealpath =
    (links: Record<string, string>) =>
    (p: string): Promise<string> =>
      Promise.resolve(links[p] ?? p)

  it('serves a normal file inside a root, unchanged', async () => {
    const file = join(root, 'me', 'a.mp4')
    await expect(resolveServable(file, policy, fakeRealpath({}))).resolves.toBe(file)
  })

  it('refuses a link inside a root that points outside it', async () => {
    const link = join(root, 'me', 'a.mp4')
    const links = { [link]: join(outside, 'secret.mp4') }
    await expect(resolveServable(link, policy, fakeRealpath(links))).resolves.toBeNull()
  })

  it('refuses a link that points at a sibling folder sharing the root name as a prefix', async () => {
    const link = join(root, 'a.mp4')
    const links = { [link]: join(`${root}-evil`, 'a.mp4') }
    await expect(resolveServable(link, policy, fakeRealpath(links))).resolves.toBeNull()
  })

  it('serves a link that stays inside the root, using the real path', async () => {
    const link = join(root, 'latest.mp4')
    const target = join(root, 'me', '2026', 'a.mp4')
    const links = { [link]: target }
    await expect(resolveServable(link, policy, fakeRealpath(links))).resolves.toBe(target)
  })

  it('still works when the root folder itself is a link', async () => {
    const realRoot = join(base, 'volumes', 'clips')
    const file = join(root, 'a.mp4')
    const links = { [root]: realRoot, [file]: join(realRoot, 'a.mp4') }
    await expect(resolveServable(file, policy, fakeRealpath(links))).resolves.toBe(
      join(realRoot, 'a.mp4')
    )
  })

  it('does not resolve explicitly allowed files', async () => {
    const picked = join(base, 'picked.mov')
    const realpath = vi.fn(fakeRealpath({}))
    await expect(resolveServable(picked, policy, realpath)).resolves.toBe(picked)
    expect(realpath).not.toHaveBeenCalled()
  })

  it('refuses when the path fails the plain isServable checks', async () => {
    const realpath = vi.fn(fakeRealpath({}))
    await expect(resolveServable(join(root, 'notes.txt'), policy, realpath)).resolves.toBeNull()
    await expect(resolveServable(join(outside, 'a.mp4'), policy, realpath)).resolves.toBeNull()
  })

  it('refuses when realpath fails', async () => {
    const file = join(root, 'a.mp4')
    const failing = (): Promise<string> => Promise.reject(new Error('ENOENT'))
    await expect(resolveServable(file, policy, failing)).resolves.toBeNull()
  })
})

describe('parseRange', () => {
  it('handles the ranges <video> sends', () => {
    expect(parseRange(null, 1000)).toBeNull()
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('rejects unsatisfiable or malformed ranges', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid')
    expect(parseRange('bytes=5-2', 1000)).toBe('invalid')
    expect(parseRange('bytes=0-1,5-6', 1000)).toBe('invalid')
    expect(parseRange('items=0-1', 1000)).toBe('invalid')
  })

  it('maps content types', () => {
    expect(contentTypeFor('/a/b.MP4')).toBe('video/mp4')
    expect(contentTypeFor('/a/b.mov')).toBe('video/quicktime')
    expect(contentTypeFor('/a/b.png')).toBe('image/png')
  })
})

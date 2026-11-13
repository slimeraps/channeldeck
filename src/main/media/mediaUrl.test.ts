import { describe, expect, it } from 'vitest'
import { contentTypeFor, isServable, mediaUrl, parseRange, pathFromMediaUrl } from './mediaUrl'

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

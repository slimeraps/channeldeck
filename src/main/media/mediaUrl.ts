import { isAbsolute, normalize, sep } from 'node:path'
import { extensionOf, isThumbnailPath, isVideoPath } from '@shared/constants/limits'

/**
 * cdmedia:// URLs let the sandboxed renderer show local videos and images without file://
 * access. The path is base64url-encoded in the URL; main only serves files that pass
 * isServable(). Pure functions, so they're testable without Electron.
 */

export const MEDIA_SCHEME = 'cdmedia'

export function mediaUrl(path: string): string {
  return `${MEDIA_SCHEME}://file/${Buffer.from(path, 'utf8').toString('base64url')}`
}

export function pathFromMediaUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== 'file') return null
    const encoded = parsed.pathname.replace(/^\//, '')
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null
    const path = Buffer.from(encoded, 'base64url').toString('utf8')
    return isAbsolute(path) ? normalize(path) : null
  } catch {
    return null
  }
}

export interface MediaPolicy {
  /** Folders whose files may be served (clip bank, renders). */
  roots: readonly string[]
  /** Exact files allowed: picked/dropped this session or referenced by a post. */
  isAllowedFile: (path: string) => boolean
}

/** Only video/image files, only inside allowed roots or explicitly allowed. */
export function isServable(path: string, policy: MediaPolicy): boolean {
  if (!isAbsolute(path) || normalize(path) !== path) return false
  if (!isVideoPath(path) && !isThumbnailPath(path)) return false
  if (policy.isAllowedFile(path)) return true
  return policy.roots.some((root) => {
    const r = normalize(root).replace(/[/\\]+$/, '')
    return path.startsWith(r + sep)
  })
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png'
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? 'application/octet-stream'
}

export interface ByteRange {
  start: number
  end: number
}

/** Parses a single "bytes=a-b" range (what <video> sends). null = serve the whole file. */
export function parseRange(header: string | null, size: number): ByteRange | 'invalid' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return 'invalid'
  const [, a = '', b = ''] = m
  if (a === '' && b === '') return 'invalid'
  let start: number
  let end: number
  if (a === '') {
    // Suffix range: last N bytes.
    const n = Number(b)
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(a)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (start > end || start >= size) return 'invalid'
  return { start, end }
}

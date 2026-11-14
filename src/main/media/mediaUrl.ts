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

/** True when path is strictly inside root (matches on a folder boundary: root + separator). */
function isInsideRoot(path: string, root: string): boolean {
  const r = normalize(root).replace(/[/\\]+$/, '')
  return path.startsWith(r + sep)
}

/** Only video/image files, only inside allowed roots or explicitly allowed. */
export function isServable(path: string, policy: MediaPolicy): boolean {
  if (!isAbsolute(path) || normalize(path) !== path) return false
  if (!isVideoPath(path) && !isThumbnailPath(path)) return false
  if (policy.isAllowedFile(path)) return true
  return policy.roots.some((root) => isInsideRoot(path, root))
}

/**
 * isServable() plus a symlink check: a file that is only allowed because it sits in a root
 * must still be inside a root after symlinks are resolved. Returns the real path to read,
 * or null if the file may not be served. Explicitly allowed files are returned as given.
 */
export async function resolveServable(
  path: string,
  policy: MediaPolicy,
  realpath: (path: string) => Promise<string>
): Promise<string | null> {
  if (!isServable(path, policy)) return null
  if (policy.isAllowedFile(path)) return path
  try {
    const real = await realpath(path)
    const realRoots = await Promise.all(
      policy.roots.map((root) => realpath(root).catch(() => null))
    )
    const inside = realRoots.some((root) => root !== null && isInsideRoot(real, root))
    return inside ? real : null
  } catch {
    return null
  }
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

/**
 * YouTube field limits. Source: https://developers.google.com/youtube/v3/docs/videos
 * (checked 2026-11-12).
 */

/** snippet.title: 100 characters, no < or >. */
export const TITLE_MAX_CHARS = 100
/** snippet.description: 5000 bytes (UTF-8), no < or >. */
export const DESCRIPTION_MAX_BYTES = 5000
/**
 * snippet.tags: 500 characters for the whole list. Commas between tags count, and a tag
 * containing a space counts as if wrapped in quotes ("Foo Baz" = 9).
 */
export const TAGS_MAX_CHARS = 500

/** thumbnails.set: JPG or PNG up to 2 MB. */
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024

/** Vertical or square videos up to 3 minutes are Shorts. */
export const SHORT_MAX_SECONDS = 180
/** Videos over 15 minutes need a verified channel. */
export const LONG_VIDEO_SECONDS = 15 * 60

export const VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
  'mpg',
  'mpeg',
  'wmv',
  'flv',
  '3gp'
] as const
export const THUMBNAIL_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const

export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isVideoPath(path: string): boolean {
  return (VIDEO_EXTENSIONS as readonly string[]).includes(extensionOf(path))
}

export function isThumbnailPath(path: string): boolean {
  return (THUMBNAIL_EXTENSIONS as readonly string[]).includes(extensionOf(path))
}

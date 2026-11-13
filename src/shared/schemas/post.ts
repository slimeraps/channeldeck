import { z } from 'zod'
import {
  LAYOUT_KINDS,
  LICENSES,
  MISSED_POLICIES,
  POST_SOURCES,
  POST_STATUSES,
  VISIBILITY_MODES
} from '../constants/enums'
import {
  DESCRIPTION_MAX_BYTES,
  LONG_VIDEO_SECONDS,
  SHORT_MAX_SECONDS,
  TAGS_MAX_CHARS,
  TITLE_MAX_CHARS
} from '../constants/limits'

/**
 * What the post editor sends. Loose on purpose so drafts can be incomplete; validatePost()
 * applies YouTube's rules, strictly for "Add to Queue" and leniently for "Save as Draft".
 * The same function runs in the editor (inline errors) and in main (before saving).
 */
export const postInputSchema = z
  .object({
    accountId: z.number().int().positive().nullable(),
    filePath: z.string().min(1).nullable(),
    title: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    categoryId: z.string().nullable(),
    playlistId: z.string().nullable(),
    thumbnailPath: z.string().min(1).nullable(),
    madeForKids: z.boolean().nullable(),
    notifySubscribers: z.boolean(),
    license: z.enum(LICENSES),
    embeddable: z.boolean(),
    defaultLanguage: z.string().nullable(),
    defaultAudioLanguage: z.string().nullable(),
    syntheticMedia: z.boolean(),
    visibilityMode: z.enum(VISIBILITY_MODES),
    publishAtUtc: z.string().nullable(),
    missedPolicy: z.enum(MISSED_POLICIES),
    /** The template it started from (for reference only). */
    templateId: z.number().int().positive().nullable().optional(),
    /** Series whose next number fills {{n}} when the post is queued. */
    seriesId: z.number().int().positive().nullable().optional(),
    /**
     * Convert to vertical (1080×1920) with a layout: filePath stays the horizontal source and
     * the post uploads the render. null = upload filePath as it is.
     */
    render: z
      .object({
        kind: z.enum(LAYOUT_KINDS),
        presetId: z.number().int().positive().nullable()
      })
      .nullable()
      .optional()
  })
  .strict()
export type PostInput = z.infer<typeof postInputSchema>

export const SAVE_MODES = ['draft', 'queue'] as const
export type SaveMode = (typeof SAVE_MODES)[number]

export interface PostIssue {
  /** Field name in PostInput, or "form" for general problems. */
  field: keyof PostInput | 'form'
  message: string
  /** Warnings never block saving. */
  severity: 'error' | 'warning'
}

// ---- measuring like YouTube does -----------------------------------------------------------

/** Characters as YouTube counts them (Unicode code points, so an emoji is one). */
export function titleLength(title: string): number {
  return [...title].length
}

export function descriptionBytes(description: string): number {
  return new TextEncoder().encode(description).length
}

/** Tag list length: commas between tags count; tags with spaces count their quotes. */
export function tagsLength(tags: readonly string[]): number {
  if (tags.length === 0) return 0
  const each = tags.reduce((sum, tag) => sum + [...tag].length + (/\s/.test(tag) ? 2 : 0), 0)
  return each + (tags.length - 1)
}

/** Tidies tags the way the chip input does: trims, drops empties and duplicates. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ')
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

const ANGLE = /[<>]/

// ---- media ---------------------------------------------------------------------------------

export interface VideoShape {
  width: number
  height: number
  durationSec: number
}

/** Vertical or square, and 3 minutes or less. */
export function isShortCandidate({ width, height, durationSec }: VideoShape): boolean {
  return width > 0 && height >= width && durationSec <= SHORT_MAX_SECONDS
}

export function isLongVideo(durationSec: number): boolean {
  return durationSec > LONG_VIDEO_SECONDS
}

/** "16:9", "9:16", "1:1", "4:3", or "1.85:1" for anything unusual. */
export function aspectRatioLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '?'
  const ratio = width / height
  const known: [string, number][] = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['4:5', 4 / 5],
    ['21:9', 21 / 9]
  ]
  const match = known.find(([, r]) => Math.abs(ratio - r) < 0.02)
  if (match) return match[0]
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`
}

// ---- validation ----------------------------------------------------------------------------

export interface ValidateOptions {
  mode: SaveMode
  now: Date
  /** Duration of the selected video, if known, for the long-video warning. */
  durationSec?: number | null
}

export function validatePost(
  input: PostInput,
  { mode, now, durationSec }: ValidateOptions
): PostIssue[] {
  const issues: PostIssue[] = []
  const err = (field: PostIssue['field'], message: string): void => {
    issues.push({ field, message, severity: 'error' })
  }
  const warn = (field: PostIssue['field'], message: string): void => {
    issues.push({ field, message, severity: 'warning' })
  }
  const queue = mode === 'queue'

  // Always checked, even for drafts: things that can't be saved to YouTube as typed.
  const titleLen = titleLength(input.title)
  if (titleLen > TITLE_MAX_CHARS)
    err('title', `Title is ${titleLen} characters; YouTube allows ${TITLE_MAX_CHARS}.`)
  if (ANGLE.test(input.title)) err('title', 'YouTube does not allow < or > in titles.')

  const bytes = descriptionBytes(input.description)
  if (bytes > DESCRIPTION_MAX_BYTES) {
    err('description', `Description is ${bytes} bytes; YouTube allows ${DESCRIPTION_MAX_BYTES}.`)
  }
  if (ANGLE.test(input.description))
    err('description', 'YouTube does not allow < or > in descriptions.')

  const tagsLen = tagsLength(input.tags)
  if (tagsLen > TAGS_MAX_CHARS) {
    err(
      'tags',
      `Tags use ${tagsLen} of ${TAGS_MAX_CHARS} characters (commas and quotes around tags with spaces count).`
    )
  }
  if (input.tags.some((t) => ANGLE.test(t))) err('tags', 'Tags cannot contain < or >.')

  if (input.visibilityMode !== 'schedule' && input.publishAtUtc) {
    // Harmless (ignored), but say so in case it was meant as a schedule.
    warn('publishAtUtc', 'The publish time is only used with "Schedule".')
  }

  if (durationSec != null && isLongVideo(durationSec)) {
    warn('filePath', 'Over 15 minutes: the channel must be verified on YouTube to upload this.')
  }

  if (!queue) {
    if (input.accountId === null) err('accountId', 'Pick a channel.')
    return issues
  }

  // Extra rules before something can go in the queue.
  const usesN = /\{\{\s*n\s*\}\}/.test(`${input.title}\n${input.description}`)
  if (usesN && !input.seriesId) {
    err('title', 'Pick a series to fill in {{n}}, or take {{n}} out.')
  }
  if (input.accountId === null) err('accountId', 'Pick a channel.')
  if (!input.filePath) err('filePath', 'Add a video file.')
  if (titleLen === 0 || input.title.trim() === '') err('title', 'Add a title.')
  if (!input.categoryId) err('categoryId', 'Pick a category.')
  if (input.madeForKids === null) err('madeForKids', 'Say whether this video is made for kids.')

  if (input.visibilityMode === 'schedule') {
    if (!input.publishAtUtc) {
      err('publishAtUtc', 'Pick when it goes public.')
    } else {
      const at = Date.parse(input.publishAtUtc)
      if (Number.isNaN(at)) err('publishAtUtc', 'That publish time is not valid.')
      else if (at <= now.getTime())
        err('publishAtUtc', 'The publish time is in the past. Pick a future time.')
    }
  }
  return issues
}

export function hasErrors(issues: readonly PostIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

// ---- views sent to the renderer --------------------------------------------------------------

export const mediaInfoSchema = z.object({
  path: z.string(),
  fileName: z.string(),
  sizeBytes: z.number(),
  mtimeMs: z.number(),
  durationSec: z.number(),
  width: z.number().int(),
  height: z.number().int(),
  aspectRatio: z.string(),
  isShort: z.boolean(),
  isLong: z.boolean(),
  videoCodec: z.string().nullable(),
  /** URL the renderer can use in <video> (cdmedia://). */
  previewUrl: z.string()
})
export type MediaInfo = z.infer<typeof mediaInfoSchema>

export const thumbnailInfoSchema = z.object({
  path: z.string(),
  fileName: z.string(),
  sizeBytes: z.number(),
  previewUrl: z.string()
})
export type ThumbnailInfo = z.infer<typeof thumbnailInfoSchema>

export const postListItemSchema = z.object({
  id: z.string(),
  accountId: z.number().int(),
  channelTitle: z.string(),
  channelColor: z.string(),
  source: z.enum(POST_SOURCES),
  status: z.enum(POST_STATUSES),
  visibilityMode: z.enum(VISIBILITY_MODES),
  title: z.string(),
  publishAtUtc: z.string().nullable(),
  uploadAfterUtc: z.string().nullable(),
  isShort: z.boolean(),
  durationSec: z.number().nullable(),
  uploadProgress: z.number(),
  lastError: z.string().nullable(),
  retryAfterUtc: z.string().nullable(),
  fileMissing: z.boolean(),
  videoPreviewUrl: z.string().nullable(),
  thumbnailPreviewUrl: z.string().nullable(),
  youtubeVideoId: z.string().nullable(),
  /** Autoposts: the rule that made it (null for manual posts or a deleted rule). */
  ruleId: z.number().int().nullable(),
  ruleName: z.string().nullable(),
  /** Converted to vertical before upload. */
  needsRender: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type PostListItem = z.infer<typeof postListItemSchema>

export const postDetailSchema = z.object({
  id: z.string(),
  status: z.enum(POST_STATUSES),
  source: z.enum(POST_SOURCES),
  input: postInputSchema,
  /** The video being edited (the horizontal source when the post renders to vertical). */
  media: mediaInfoSchema.nullable(),
  /** The vertical render, if it has been made already (Render now, or uploaded). */
  rendered: mediaInfoSchema.nullable(),
  /** For Twitch clip posts: the clip's files, for the Format switch. */
  clip: z
    .object({
      twitchAccountId: z.number().int(),
      landscapePath: z.string().nullable(),
      portraitPath: z.string().nullable()
    })
    .nullable(),
  thumbnail: thumbnailInfoSchema.nullable(),
  editable: z.boolean()
})
export type PostDetail = z.infer<typeof postDetailSchema>

export const postFilterSchema = z
  .object({
    accountId: z.number().int().positive().optional(),
    statuses: z.array(z.enum(POST_STATUSES)).optional(),
    source: z.enum(POST_SOURCES).optional()
  })
  .strict()

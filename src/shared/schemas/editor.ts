import { z } from 'zod'

/** What the editor needs about a video it edits (editor:source). */
export const editorSourceSchema = z.object({
  path: z.string(),
  fileName: z.string(),
  durationSec: z.number(),
  width: z.number().int(),
  height: z.number().int(),
  fps: z.number().nullable(),
  hasAudio: z.boolean(),
  /** cdmedia:// URL for <video>. */
  previewUrl: z.string(),
  /** Set when the file is a banked Twitch clip (its channel's saved layouts apply). */
  clipId: z.string().nullable(),
  clipTitle: z.string().nullable(),
  twitchAccountId: z.number().int().nullable(),
  /** What {{clip_title}}, {{game}}… become for a banked clip (empty for other files). */
  values: z.record(z.string(), z.string())
})
export type EditorSource = z.infer<typeof editorSourceSchema>

/**
 * Timeline pictures for a source, made once and cached: a filmstrip (`frames` tiles side by
 * side, spread evenly over the whole video) and an audio waveform over the whole video.
 */
export const editorStripsSchema = z.object({
  filmstripUrl: z.string().nullable(),
  frames: z.number().int(),
  waveformUrl: z.string().nullable()
})
export type EditorStrips = z.infer<typeof editorStripsSchema>

/** A finished render (editor:render). */
export const editorRenderSchema = z.object({
  path: z.string(),
  previewUrl: z.string(),
  durationSec: z.number(),
  width: z.number().int(),
  height: z.number().int(),
  sizeBytes: z.number(),
  /** True when an identical edit had already been rendered (the file was reused). */
  reused: z.boolean()
})
export type EditorRender = z.infer<typeof editorRenderSchema>

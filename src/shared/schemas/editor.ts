import { z } from 'zod'
import type { CanvasKind } from '../geometry'
import { CANVAS_KINDS, editSpecSchema } from './edit'

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

const projectId = z.number().int().positive()

/** A saved edit on the Editor page's list. */
export const editProjectSummarySchema = z.object({
  id: projectId,
  name: z.string(),
  canvas: z.enum(CANVAS_KINDS as [CanvasKind, ...CanvasKind[]]),
  pieces: z.number().int(),
  durationSec: z.number(),
  /** A frame from the first piece (null until it has been made). */
  thumbnailUrl: z.string().nullable(),
  updatedAt: z.string(),
  /** Some file the edit uses is gone. */
  missingFiles: z.boolean()
})
export type EditProjectSummary = z.infer<typeof editProjectSummarySchema>

export const editProjectSchema = z.object({
  id: projectId,
  name: z.string(),
  spec: editSpecSchema,
  updatedAt: z.string()
})
export type EditProject = z.infer<typeof editProjectSchema>

export const projectNameSchema = z.string().trim().min(1, 'Name the project').max(80)

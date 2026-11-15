import { z } from 'zod'
import { LAYOUT_KINDS } from '../constants/enums'
import { CANVAS_SIZES, type CanvasKind } from '../geometry'
import { renderTemplate, type TemplateValues } from '../templates'
import { layoutCropsSchema } from './autopost'

/**
 * The editor's one edit model (PLAN.md → Editor). An edit is a list of segments played in
 * order (joining clips is just more segments), each cut from a source file and framed for
 * the canvas, plus text layers on the output timeline. `posts.render_json` holds either an
 * EditSpec (`version: 2`) or the older vertical-render spec, and the upload job renders
 * whichever it is just before uploading. Relative imports only: main, the renderer and
 * (later) the website's core all use this file.
 */

export const EDIT_SPEC_VERSION = 2

/** Longest edit we render (well past YouTube's 3-minute Shorts limit). */
export const MAX_EDIT_SECONDS = 60 * 60
/** Shortest segment the timeline keeps. */
export const MIN_SEGMENT_SECONDS = 0.1

export const CANVAS_KINDS = Object.keys(CANVAS_SIZES) as CanvasKind[]

/** Fonts bundled in resources/fonts (OFL), by family name. */
export const EDIT_FONTS = ['Archivo Black', 'Anton', 'Bebas Neue'] as const
export type EditFont = (typeof EDIT_FONTS)[number]

export const TEXT_ANIMATIONS = ['none', 'fade', 'pop'] as const
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const

const seconds = z.number().min(0).max(MAX_EDIT_SECONDS)
const unit = z.number().min(0).max(1)
/** #RRGGBB or #RRGGBBAA. */
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Use a color like #ffffff')

/** A vertical canvas: one of the layouts (built-in or a saved preset's crops). */
export const editLayoutSchema = z
  .object({
    kind: z.enum(LAYOUT_KINDS),
    presetId: z.number().int().positive().nullable(),
    crops: layoutCropsSchema
  })
  .strict()

/**
 * Horizontal and square canvases: the part of the source to show. The largest rectangle of
 * the canvas's shape, zoomed by `zoomStart` → `zoomEnd` over the segment (1 = whole frame),
 * centered on (cx, cy) as fractions of the source frame.
 */
export const editFrameSchema = z
  .object({
    zoomStart: z.number().min(1).max(4),
    zoomEnd: z.number().min(1).max(4),
    cx: unit,
    cy: unit
  })
  .strict()

export const editSegmentSchema = z
  .object({
    sourcePath: z.string().min(1),
    /** The Twitch clip it comes from, if any (never-twice applies to it). */
    clipId: z.string().min(1).nullable(),
    inSec: seconds,
    outSec: seconds,
    layout: editLayoutSchema.nullable(),
    frame: editFrameSchema.nullable()
  })
  .strict()
  .refine((s) => s.outSec - s.inSec >= MIN_SEGMENT_SECONDS, {
    message: 'A segment must be at least 0.1 seconds long.',
    path: ['outSec']
  })

export const textStyleSchema = z
  .object({
    font: z.enum(EDIT_FONTS),
    /** Font size in canvas pixels (the canvas is 1080 or 1920 wide). */
    size: z.number().int().min(16).max(400),
    color,
    /** Outline around the letters (0 = none). Ignored when the text has a box. */
    outlineColor: color,
    outlineWidth: z.number().min(0).max(30),
    /** Drop shadow distance in pixels (0 = none). */
    shadow: z.number().min(0).max(30),
    /** A solid box behind the text instead of an outline. */
    box: z.boolean(),
    boxColor: color,
    align: z.enum(TEXT_ALIGNS)
  })
  .strict()

export const editTextSchema = z
  .object({
    /** Stable id for the editor (selection, undo). */
    id: z.string().min(1).max(64),
    /** May contain template variables such as {{clip_title}}, filled before rendering. */
    text: z.string().min(1).max(500),
    startSec: seconds,
    endSec: seconds,
    /** Where the text's anchor sits on the canvas, as fractions (0.5, 0.5 = center). */
    x: unit,
    y: unit,
    style: textStyleSchema,
    animation: z.enum(TEXT_ANIMATIONS)
  })
  .strict()
  .refine((t) => t.endSec > t.startSec, {
    message: 'Text must end after it starts.',
    path: ['endSec']
  })

/** Image files a sticker or logo can be: still images, and GIFs (which loop). */
export const STICKER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const

/** A sticker, logo or other image on top of the video (under the text). */
export const editOverlaySchema = z
  .object({
    id: z.string().min(1).max(64),
    /** File name in the editor's asset library (userData/editor-assets). */
    asset: z
      .string()
      .regex(/^[0-9a-f]{16,64}\.(png|jpe?g|webp|gif)$/, 'Not a file from the sticker library'),
    startSec: seconds,
    endSec: seconds,
    /** Center of the image on the canvas, as fractions. */
    x: unit,
    y: unit,
    /** Width as a share of the canvas width (the height follows the image's shape). */
    width: z.number().min(0.02).max(1),
    opacity: z.number().min(0.05).max(1)
  })
  .strict()
  .refine((o) => o.endSec > o.startSec, {
    message: 'A sticker must end after it starts.',
    path: ['endSec']
  })

export const editSpecSchema = z
  .object({
    version: z.literal(EDIT_SPEC_VERSION),
    canvas: z.enum(CANVAS_KINDS as [CanvasKind, ...CanvasKind[]]),
    segments: z.array(editSegmentSchema).min(1).max(100),
    texts: z.array(editTextSchema).max(100),
    /** Stickers and logos (older edits don't have the field: none). */
    overlays: z.array(editOverlaySchema).max(50).optional(),
    /** Original audio volume (1 = unchanged, 0 = muted). */
    volume: z.number().min(0).max(2)
  })
  .strict()
  .refine((e) => editDuration(e) <= MAX_EDIT_SECONDS, {
    message: 'An edit can be at most an hour long.',
    path: ['segments']
  })

export type EditSpec = z.infer<typeof editSpecSchema>
export type EditSegment = z.infer<typeof editSegmentSchema>
export type EditText = z.infer<typeof editTextSchema>
export type TextStyle = z.infer<typeof textStyleSchema>
export type EditLayout = z.infer<typeof editLayoutSchema>
export type EditFrame = z.infer<typeof editFrameSchema>
export type EditOverlay = z.infer<typeof editOverlaySchema>

/** The edit's stickers (none for edits made before stickers existed). */
export const overlaysOf = (spec: Pick<EditSpec, 'overlays'>): EditOverlay[] => spec.overlays ?? []

/** GIFs play (and loop); other images are still. */
export const isAnimatedAsset = (asset: string): boolean => asset.toLowerCase().endsWith('.gif')

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'Archivo Black',
  size: 96,
  color: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 8,
  shadow: 0,
  box: false,
  boxColor: '#000000cc',
  align: 'center'
}

/** Just the timing of a segment (keeps these helpers usable inside the schema's refine). */
interface Timed {
  inSec: number
  outSec: number
}

export const segmentDuration = (s: Timed): number => Math.max(0, s.outSec - s.inSec)

/** Length of the finished video in seconds. */
export function editDuration(spec: { segments: readonly Timed[] }): number {
  return spec.segments.reduce((sum, s) => sum + segmentDuration(s), 0)
}

/** Where each segment starts on the output timeline. */
export function segmentStarts(spec: { segments: readonly Timed[] }): number[] {
  const starts: number[] = []
  let at = 0
  for (const s of spec.segments) {
    starts.push(at)
    at += segmentDuration(s)
  }
  return starts
}

/** The older posts.render_json shape: one landscape clip converted to vertical. */
export interface LegacyRenderSpec {
  sourcePath: string
  kind: (typeof LAYOUT_KINDS)[number]
  crops: z.infer<typeof layoutCropsSchema>
  presetId: number | null
}

export type RenderJson = LegacyRenderSpec | EditSpec

export function isEditSpec(json: RenderJson | null | undefined): json is EditSpec {
  return Boolean(json && 'version' in json && json.version === EDIT_SPEC_VERSION)
}

/** Every file a post's render reads (each must exist before rendering, and stay until done). */
export function renderSources(json: RenderJson | null | undefined): string[] {
  if (!json) return []
  if (!isEditSpec(json)) return [json.sourcePath]
  return [...new Set(json.segments.map((s) => s.sourcePath))]
}

/** The file to preview before the render exists: the (first) source. */
export function renderPreviewSource(json: RenderJson | null | undefined): string | null {
  return renderSources(json)[0] ?? null
}

/** Reads an older vertical render as a one-segment edit (the editor opens it this way). */
export function editFromLegacy(spec: LegacyRenderSpec, durationSec: number): EditSpec {
  return {
    version: EDIT_SPEC_VERSION,
    canvas: 'vertical',
    segments: [
      {
        sourcePath: spec.sourcePath,
        clipId: null,
        inSec: 0,
        outSec: Math.max(MIN_SEGMENT_SECONDS, durationSec),
        layout: { kind: spec.kind, presetId: spec.presetId, crops: spec.crops },
        frame: null
      }
    ],
    texts: [],
    volume: 1
  }
}

/** Fills {{variables}} in the text layers (clip title, game…). Unknown ones stay as typed. */
export function fillEditText(spec: EditSpec, values: TemplateValues): EditSpec {
  if (!spec.texts.some((t) => t.text.includes('{{'))) return spec
  return { ...spec, texts: spec.texts.map((t) => ({ ...t, text: renderTemplate(t.text, values) })) }
}

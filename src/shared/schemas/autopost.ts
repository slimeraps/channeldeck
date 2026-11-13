import { z } from 'zod'
import { AUTOPOST_FORMATS, AUTOPOST_MODES, LAYOUT_KINDS, PICK_ORDERS } from '../constants/enums'

/** Autopost rules and layout presets: shared by the rule editor (renderer) and main. */

const id = z.number().int().positive()
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 18:30')

export const autopostFiltersSchema = z
  .object({
    gameIds: z.array(z.string().min(1)).max(50).optional(),
    minDurationSec: z.number().min(0).max(3600).optional(),
    maxDurationSec: z.number().min(0).max(3600).optional(),
    minViews: z.number().int().min(0).optional(),
    featuredOnly: z.boolean().optional()
  })
  .strict()
  .refine(
    (f) =>
      f.minDurationSec === undefined ||
      f.maxDurationSec === undefined ||
      f.minDurationSec <= f.maxDurationSec,
    { message: 'The shortest length must be below the longest.', path: ['maxDurationSec'] }
  )

export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the rule a name').max(80),
    youtubeAccountId: id,
    twitchAccountIds: z.array(id).min(1, 'Pick at least one Twitch channel').max(20),
    slots: z.array(hhmm).min(1, 'Add at least one time').max(24),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, 'Pick at least one day').max(7),
    pickOrder: z.enum(PICK_ORDERS),
    filters: autopostFiltersSchema,
    format: z.enum(AUTOPOST_FORMATS),
    /** Layout for vertical renders; null = blurred fill. */
    layoutPresetId: id.nullable(),
    /** Use Twitch's own vertical version when a clip has one, instead of rendering. */
    useTwitchVertical: z.boolean(),
    titleTpl: z.string().trim().min(1, 'Add a title template').max(500),
    descriptionTpl: z.string().max(10_000),
    tags: z.array(z.string().max(100)).max(100),
    categoryId: z.string().nullable(),
    playlistId: z.string().nullable(),
    madeForKids: z.boolean(),
    mode: z.enum(AUTOPOST_MODES),
    lookaheadDays: z.number().int().min(1).max(14),
    enabled: z.boolean(),
    nextNumber: z.number().int().min(1).max(1_000_000)
  })
  .strict()
export type RuleInput = z.infer<typeof ruleInputSchema>

export const ruleViewSchema = z.object({
  id,
  input: ruleInputSchema,
  channelTitle: z.string(),
  channelColor: z.string(),
  /** The rule's Twitch channels that are still connected, with their colors. */
  twitchSources: z.array(z.object({ id, name: z.string(), color: z.string() })),
  layoutName: z.string().nullable(),
  nextSlotUtc: z.string().nullable(),
  /** Autoposts waiting for your approval. */
  pendingApproval: z.number().int(),
  /** Autoposts created and not yet published (any active state). */
  upcoming: z.number().int(),
  /** Clips this rule could still use. */
  eligibleClips: z.number().int(),
  skippedClips: z.number().int(),
  /** Why the rule can't run right now (e.g. channel needs re-auth), or null. */
  blockedReason: z.string().nullable()
})
export type RuleView = z.infer<typeof ruleViewSchema>

export const ruleSaveSchema = z.object({ id: id.optional(), input: ruleInputSchema }).strict()

export const rulePreviewInputSchema = ruleInputSchema
  .pick({
    youtubeAccountId: true,
    twitchAccountIds: true,
    slots: true,
    weekdays: true,
    pickOrder: true,
    filters: true,
    format: true,
    layoutPresetId: true,
    useTwitchVertical: true,
    titleTpl: true,
    descriptionTpl: true,
    lookaheadDays: true,
    nextNumber: true
  })
  .extend({ ruleId: id.optional() })
  .strict()
export type RulePreviewInput = z.infer<typeof rulePreviewInputSchema>

export const rulePreviewSchema = z.object({
  /** The next empty slots in the look-ahead, each with the clip it would get. */
  slots: z.array(
    z.object({
      atUtc: z.string(),
      clip: z
        .object({
          id: z.string(),
          title: z.string(),
          thumbUrl: z.string().nullable(),
          renderedTitle: z.string(),
          renderedDescription: z.string(),
          /** Converted to vertical with the layout (no portrait file). */
          needsRender: z.boolean()
        })
        .nullable()
    })
  ),
  eligibleClips: z.number().int(),
  titleTooLong: z.boolean()
})
export type RulePreview = z.infer<typeof rulePreviewSchema>

export const quotaForecastSchema = z.array(
  z.object({
    day: z.string(),
    uploads: z.number().int(),
    units: z.number().int(),
    overUploads: z.boolean(),
    overUnits: z.boolean()
  })
)

// ---- layout presets --------------------------------------------------------------------------

const rect = z
  .object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive()
  })
  .strict()

export const layoutCropsSchema = z
  .object({
    facecam: rect.optional(),
    gameplay: rect.optional(),
    sourceWidth: z.number().int().positive().optional(),
    sourceHeight: z.number().int().positive().optional()
  })
  .strict()

export const layoutInputSchema = z
  .object({
    twitchAccountId: id,
    name: z.string().trim().min(1, 'Name the layout').max(60),
    kind: z.enum(LAYOUT_KINDS),
    crops: layoutCropsSchema
  })
  .strict()
  .refine((l) => l.kind !== 'facecam_split' || (l.crops.facecam && l.crops.gameplay), {
    message: 'Draw both the facecam and the gameplay boxes.',
    path: ['crops']
  })
export type LayoutInput = z.infer<typeof layoutInputSchema>

export const layoutViewSchema = z.object({
  id,
  twitchAccountId: id,
  twitchName: z.string(),
  twitchColor: z.string(),
  name: z.string(),
  kind: z.enum(LAYOUT_KINDS),
  crops: layoutCropsSchema,
  usedByRules: z.number().int()
})
export type LayoutView = z.infer<typeof layoutViewSchema>

export const sampleFrameInputSchema = z
  .object({
    twitchAccountId: id,
    clipId: z.string().min(1).optional(),
    atSec: z.number().min(0).max(3600).optional()
  })
  .strict()

export const sampleFrameSchema = z.object({
  clipId: z.string(),
  clipTitle: z.string(),
  frameUrl: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  durationSec: z.number(),
  atSec: z.number()
})
export type SampleFrame = z.infer<typeof sampleFrameSchema>

export const testRenderInputSchema = z
  .object({
    clipId: z.string().min(1),
    kind: z.enum(LAYOUT_KINDS),
    crops: layoutCropsSchema,
    seconds: z.number().int().min(2).max(30).optional()
  })
  .strict()

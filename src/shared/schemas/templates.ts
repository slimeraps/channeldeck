import { z } from 'zod'

/** Templates and series for manual posts (Templates page + post editor). */

const id = z.number().int().positive()

export const templateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the template').max(80),
    /** Only offer it for this channel (null = every channel). */
    accountId: id.nullable(),
    titleTpl: z.string().max(300),
    descriptionTpl: z.string().max(10_000),
    tags: z.array(z.string().max(100)).max(100)
  })
  .strict()
export type TemplateInput = z.infer<typeof templateInputSchema>

export const templateViewSchema = z.object({
  id,
  input: templateInputSchema,
  channelTitle: z.string().nullable(),
  seriesCount: z.number().int()
})
export type TemplateView = z.infer<typeof templateViewSchema>

export const seriesInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the series').max(80),
    templateId: id,
    accountId: id.nullable(),
    /** The {{n}} the next queued post gets. */
    nextNumber: z.number().int().min(0).max(1_000_000)
  })
  .strict()
export type SeriesInput = z.infer<typeof seriesInputSchema>

export const seriesViewSchema = z.object({
  id,
  input: seriesInputSchema,
  templateName: z.string(),
  channelTitle: z.string().nullable(),
  /** The next post's title, e.g. "MW4 Day 9". */
  nextTitle: z.string(),
  /** Posts that already took a number from it. */
  numbered: z.number().int()
})
export type SeriesView = z.infer<typeof seriesViewSchema>

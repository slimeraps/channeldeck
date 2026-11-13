import type { License } from '../constants/enums'

/**
 * Shapes stored in JSON columns. Relative imports only: drizzle-kit loads the schema
 * (which imports these types) without our path aliases.
 */

/** Per-channel defaults applied to new posts. */
export interface AccountDefaults {
  categoryId?: string
  tags?: string[]
  playlistId?: string
  madeForKids?: boolean
  defaultLanguage?: string
  defaultAudioLanguage?: string
  license?: License
  descriptionFooter?: string
}

/** Where a resumable backfill stopped: the next 7-day window to fetch. */
export interface BackfillCursor {
  /** Start of the next window to fetch (UTC ISO). */
  nextWindowStartUtc: string
  /** Page cursor inside that window, if it was interrupted mid-window. */
  after?: string
  windowsDone: number
  windowsTotal: number
}

/** A crop rectangle in source-video pixels. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** Facecam-on-top split: two rectangles drawn once in the crop editor. */
export interface LayoutCrops {
  facecam?: CropRect
  gameplay?: CropRect
  /** Size of the sample frame the rectangles were drawn on. */
  sourceWidth?: number
  sourceHeight?: number
}

/** Daily time slots, local time, "HH:mm". */
export type SlotTimes = string[]

/** ISO weekday numbers, 1 = Monday ... 7 = Sunday. */
export type Weekdays = number[]

export interface AutopostFilters {
  gameIds?: string[]
  minDurationSec?: number
  maxDurationSec?: number
  minViews?: number
  featuredOnly?: boolean
}

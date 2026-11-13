import type { QuotaBucket } from './enums'

/**
 * YouTube Data API quota costs: the only place they live.
 * Source: https://developers.google.com/youtube/v3/determine_quota_cost (checked 2026-11-12).
 *
 * Quota belongs to the Google Cloud project and is shared by every connected channel.
 * videos.insert has its own bucket (calls per day). Everything else draws on one pool of
 * units. Both reset at midnight Pacific time.
 */

export const DAILY_UPLOAD_CALLS = 100
export const DAILY_UNITS = 10_000

export const YOUTUBE_METHODS = [
  'videos.insert',
  'videos.list',
  'videos.update',
  'videos.delete',
  'thumbnails.set',
  'playlistItems.insert',
  'playlists.list',
  'channels.list',
  'videoCategories.list'
] as const
export type YouTubeMethod = (typeof YOUTUBE_METHODS)[number]

export const QUOTA_COSTS: Record<YouTubeMethod, { bucket: QuotaBucket; cost: number }> = {
  'videos.insert': { bucket: 'upload', cost: 1 },
  'videos.list': { bucket: 'units', cost: 1 },
  'videos.update': { bucket: 'units', cost: 50 },
  'videos.delete': { bucket: 'units', cost: 50 },
  'thumbnails.set': { bucket: 'units', cost: 50 },
  'playlistItems.insert': { bucket: 'units', cost: 50 },
  'playlists.list': { bucket: 'units', cost: 1 },
  'channels.list': { bucket: 'units', cost: 1 },
  'videoCategories.list': { bucket: 'units', cost: 1 }
}

/** The time zone YouTube quota days follow. */
export const QUOTA_TIME_ZONE = 'America/Los_Angeles'

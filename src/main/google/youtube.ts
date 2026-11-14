import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { youtube, type youtube_v3 } from '@googleapis/youtube'
import type { OAuth2Client } from 'google-auth-library'
import type { YouTubeMethod } from '@shared/constants/quota'
import type { YouTubeVideoState } from '../domain/statusSync'
import { type UploadedVideo, uploadResumable } from './resumableUpload'

/**
 * Thin wrapper over the official YouTube Data API client. Every call is recorded for the
 * quota meter before it's made (a failed call can still cost quota). Phase 4 adds uploads
 * and Dry Run.
 */

export interface ChannelInfo {
  channelId: string
  title: string
  handle: string | null
  avatarUrl: string | null
  uploadsPlaylistId: string | null
}

export interface VideoCategory {
  id: string
  title: string
  assignable: boolean
}

export interface PlaylistInfo {
  id: string
  title: string
  itemCount: number
  privacy: string | null
}

export interface UploadVideoArgs {
  /** The `video` resource: snippet + status. */
  resource: { snippet: Record<string, unknown>; status: Record<string, unknown> }
  notifySubscribers: boolean
  filePath: string
  sizeBytes: number
  contentType: string
  onProgress?: (sentBytes: number, totalBytes: number) => void
  onRetry?: (message: string, attempt: number, delayMs: number) => void
  signal?: AbortSignal
}

export type { UploadedVideo }

export interface YouTubeApi {
  /** True for the Dry Run stand-in (nothing reaches YouTube). */
  readonly dryRun: boolean
  channelsMine(): Promise<ChannelInfo[]>
  videoCategories(regionCode?: string, hl?: string): Promise<VideoCategory[]>
  playlistsMine(): Promise<PlaylistInfo[]>
  uploadVideo(args: UploadVideoArgs): Promise<UploadedVideo>
  setThumbnail(videoId: string, imagePath: string, mimeType: string): Promise<void>
  addToPlaylist(playlistId: string, videoId: string): Promise<void>
  /** videos.list part=status,processingDetails for up to 50 ids (1 unit). Missing ids = not found. */
  videosStatus(ids: string[]): Promise<YouTubeVideoState[]>
  /** videos.list part=snippet for up to 50 ids (1 unit): id → title. Missing ids are left out. */
  videoTitles(ids: string[]): Promise<Map<string, string>>
  /** The current `status` part of one video, or null if it doesn't exist (1 unit). */
  videoStatusPart(videoId: string): Promise<Record<string, unknown> | null>
  /** videos.update part=status with the complete status part (50 units). */
  updateVideoStatus(videoId: string, status: Record<string, unknown>): Promise<void>
  /** videos.delete (50 units). */
  deleteVideo(videoId: string): Promise<void>
}

export interface YouTubeApiDeps {
  auth: OAuth2Client
  recordCall: (method: YouTubeMethod) => void
}

function toChannelInfo(item: youtube_v3.Schema$Channel): ChannelInfo | null {
  if (!item.id) return null
  const thumbs = item.snippet?.thumbnails
  return {
    channelId: item.id,
    title: item.snippet?.title ?? item.id,
    handle: item.snippet?.customUrl ?? null,
    avatarUrl: thumbs?.medium?.url ?? thumbs?.default?.url ?? null,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null
  }
}

export function createYouTubeApi({ auth, recordCall }: YouTubeApiDeps): YouTubeApi {
  const yt = youtube({ version: 'v3', auth })

  return {
    dryRun: false,

    async channelsMine() {
      recordCall('channels.list')
      const res = await yt.channels.list({ part: ['snippet', 'contentDetails'], mine: true })
      return (res.data.items ?? []).map(toChannelInfo).filter((c): c is ChannelInfo => c !== null)
    },

    async videoCategories(regionCode = 'US', hl = 'en_US') {
      recordCall('videoCategories.list')
      const res = await yt.videoCategories.list({ part: ['snippet'], regionCode, hl })
      return (res.data.items ?? [])
        .filter((c) => c.id && c.snippet?.title)
        .map((c) => ({
          id: c.id as string,
          title: c.snippet?.title as string,
          assignable: c.snippet?.assignable ?? false
        }))
    },

    async playlistsMine() {
      const playlists: PlaylistInfo[] = []
      let pageToken: string | undefined
      do {
        recordCall('playlists.list')
        const res = await yt.playlists.list({
          part: ['snippet', 'contentDetails', 'status'],
          mine: true,
          maxResults: 50,
          pageToken
        })
        for (const p of res.data.items ?? []) {
          if (!p.id) continue
          playlists.push({
            id: p.id,
            title: p.snippet?.title ?? p.id,
            itemCount: p.contentDetails?.itemCount ?? 0,
            privacy: p.status?.privacyStatus ?? null
          })
        }
        pageToken = res.data.nextPageToken ?? undefined
      } while (pageToken)
      return playlists.sort((a, b) => a.title.localeCompare(b.title))
    },

    async uploadVideo(args) {
      recordCall('videos.insert')
      return uploadResumable({
        accessToken: async () => {
          const { token } = await auth.getAccessToken()
          if (!token) throw new Error('No access token for this channel')
          return token
        },
        resource: args.resource,
        parts: ['snippet', 'status'],
        notifySubscribers: args.notifySubscribers,
        filePath: args.filePath,
        sizeBytes: args.sizeBytes,
        contentType: args.contentType,
        ...(args.onProgress ? { onProgress: args.onProgress } : {}),
        ...(args.onRetry ? { onRetry: args.onRetry } : {}),
        ...(args.signal ? { signal: args.signal } : {})
      })
    },

    async setThumbnail(videoId, imagePath, mimeType) {
      recordCall('thumbnails.set')
      await yt.thumbnails.set({ videoId, media: { mimeType, body: createReadStream(imagePath) } })
    },

    async addToPlaylist(playlistId, videoId) {
      recordCall('playlistItems.insert')
      await yt.playlistItems.insert({
        part: ['snippet'],
        requestBody: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } }
      })
    },

    async videosStatus(ids) {
      if (ids.length === 0) return []
      if (ids.length > 50) throw new Error('videos.list takes at most 50 ids')
      recordCall('videos.list')
      const res = await yt.videos.list({
        part: ['status', 'processingDetails'],
        id: ids,
        maxResults: 50
      })
      return (res.data.items ?? [])
        .filter((v) => v.id)
        .map((v) => ({
          id: v.id as string,
          status: {
            uploadStatus: v.status?.uploadStatus ?? null,
            failureReason: v.status?.failureReason ?? null,
            rejectionReason: v.status?.rejectionReason ?? null,
            privacyStatus: v.status?.privacyStatus ?? null,
            publishAt: v.status?.publishAt ?? null
          },
          processingDetails: {
            processingStatus: v.processingDetails?.processingStatus ?? null,
            processingFailureReason: v.processingDetails?.processingFailureReason ?? null
          }
        }))
    },

    async videoTitles(ids) {
      const titles = new Map<string, string>()
      if (ids.length === 0) return titles
      if (ids.length > 50) throw new Error('videos.list takes at most 50 ids')
      recordCall('videos.list')
      const res = await yt.videos.list({ part: ['snippet'], id: ids, maxResults: 50 })
      for (const v of res.data.items ?? []) {
        if (v.id && v.snippet?.title) titles.set(v.id, v.snippet.title)
      }
      return titles
    },

    async videoStatusPart(videoId) {
      recordCall('videos.list')
      const res = await yt.videos.list({ part: ['status'], id: [videoId] })
      const status = res.data.items?.[0]?.status
      return status ? ({ ...status } as Record<string, unknown>) : null
    },

    async updateVideoStatus(videoId, status) {
      recordCall('videos.update')
      await yt.videos.update({ part: ['status'], requestBody: { id: videoId, status } })
    },

    async deleteVideo(videoId) {
      recordCall('videos.delete')
      await yt.videos.delete({ id: videoId })
    }
  }
}

/**
 * Dry Run: logs exactly which write calls would run, with their payloads, and pretends they
 * worked. It never touches the network (not even to refresh a token). Read-only lookups
 * (channels, categories, playlists) still go to the real API through `reads`, because the
 * editor needs them and they change nothing.
 */
export function createDryRunYouTubeApi(deps: {
  reads: Pick<
    YouTubeApi,
    | 'channelsMine'
    | 'videoCategories'
    | 'playlistsMine'
    | 'videosStatus'
    | 'videoTitles'
    | 'videoStatusPart'
  >
  recordCall: (method: YouTubeMethod) => void
  log: (message: string, payload: Record<string, unknown>) => void
  /** Simulated upload duration, so the progress bar has something to show. */
  uploadMs?: number
}): YouTubeApi {
  const uploadMs = deps.uploadMs ?? 1500
  return {
    dryRun: true,
    channelsMine: () => deps.reads.channelsMine(),
    videoCategories: (region, hl) => deps.reads.videoCategories(region, hl),
    playlistsMine: () => deps.reads.playlistsMine(),

    async uploadVideo(args) {
      deps.recordCall('videos.insert')
      deps.log('videos.insert (resumable)', {
        part: 'snippet,status',
        notifySubscribers: args.notifySubscribers,
        body: args.resource,
        file: args.filePath,
        bytes: args.sizeBytes,
        contentType: args.contentType
      })
      const steps = 10
      for (let i = 0; i <= steps; i++) {
        if (args.signal?.aborted) throw args.signal.reason ?? new Error('aborted')
        args.onProgress?.(Math.round((args.sizeBytes * i) / steps), args.sizeBytes)
        if (i < steps) await new Promise((r) => setTimeout(r, uploadMs / steps))
      }
      return {
        id: `DRYRUN-${randomBytes(4).toString('hex')}`,
        status: { ...args.resource.status, uploadStatus: 'uploaded' }
      }
    },

    async setThumbnail(videoId, imagePath, mimeType) {
      deps.recordCall('thumbnails.set')
      deps.log('thumbnails.set', { videoId, file: imagePath, mimeType })
    },

    async addToPlaylist(playlistId, videoId) {
      deps.recordCall('playlistItems.insert')
      deps.log('playlistItems.insert', {
        part: 'snippet',
        body: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } }
      })
    },

    videosStatus: (ids) => deps.reads.videosStatus(ids),
    videoTitles: (ids) => deps.reads.videoTitles(ids),

    // Dry Run videos don't exist on YouTube; pretend their status is what we asked for.
    async videoStatusPart(videoId) {
      if (videoId.startsWith('DRYRUN-'))
        return { privacyStatus: 'private', uploadStatus: 'processed' }
      return deps.reads.videoStatusPart(videoId)
    },

    async updateVideoStatus(videoId, status) {
      deps.recordCall('videos.update')
      deps.log('videos.update', { part: 'status', body: { id: videoId, status } })
    },

    async deleteVideo(videoId) {
      deps.recordCall('videos.delete')
      deps.log('videos.delete', { id: videoId })
    }
  }
}

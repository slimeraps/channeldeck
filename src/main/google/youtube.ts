import { youtube, type youtube_v3 } from '@googleapis/youtube'
import type { OAuth2Client } from 'google-auth-library'
import type { YouTubeMethod } from '@shared/constants/quota'

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

export interface YouTubeApi {
  channelsMine(): Promise<ChannelInfo[]>
  videoCategories(regionCode?: string, hl?: string): Promise<VideoCategory[]>
  playlistsMine(): Promise<PlaylistInfo[]>
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
    }
  }
}

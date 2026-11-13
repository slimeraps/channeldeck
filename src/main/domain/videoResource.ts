import type { VisibilityMode } from '@shared/constants/enums'
import { toYouTubePublishAt } from '@shared/lib/time'

/**
 * The `video` resource sent with videos.insert, built from a post. Pure.
 *
 * Schedule → privacyStatus "private" + status.publishAt (YouTube flips it public then).
 * Public / Unlisted / Private now → that privacyStatus, no publishAt.
 */

export interface PostForUpload {
  title: string
  description: string
  tags: string[]
  categoryId: string | null
  defaultLanguage: string | null
  defaultAudioLanguage: string | null
  visibilityMode: VisibilityMode
  publishAtUtc: string | null
  madeForKids: boolean | null
  license: 'youtube' | 'creativeCommon'
  embeddable: boolean
  syntheticMedia: boolean
}

export interface VideoResource {
  snippet: Record<string, unknown>
  status: Record<string, unknown>
}

export function buildVideoResource(post: PostForUpload): VideoResource {
  if (!post.categoryId) throw new Error('A category is required to upload.')
  if (post.madeForKids === null) throw new Error('"Made for kids" must be set to upload.')

  const snippet: Record<string, unknown> = {
    title: post.title,
    description: post.description,
    categoryId: post.categoryId
  }
  if (post.tags.length > 0) snippet['tags'] = post.tags
  if (post.defaultLanguage) snippet['defaultLanguage'] = post.defaultLanguage
  if (post.defaultAudioLanguage) snippet['defaultAudioLanguage'] = post.defaultAudioLanguage

  const scheduled = post.visibilityMode === 'schedule'
  if (scheduled && !post.publishAtUtc) throw new Error('A scheduled post needs a publish time.')

  const status: Record<string, unknown> = {
    privacyStatus: scheduled ? 'private' : post.visibilityMode,
    selfDeclaredMadeForKids: post.madeForKids,
    license: post.license,
    embeddable: post.embeddable,
    containsSyntheticMedia: post.syntheticMedia
  }
  if (scheduled && post.publishAtUtc) status['publishAt'] = toYouTubePublishAt(post.publishAtUtc)

  return { snippet, status }
}

/** YouTube put a Public/Unlisted upload in private: the unverified-project lock. */
export function looksLockedPrivate(
  mode: VisibilityMode,
  returnedPrivacy: string | undefined
): boolean {
  return (mode === 'public' || mode === 'unlisted') && returnedPrivacy === 'private'
}

export const AUDIT_LOCK_MESSAGE =
  'YouTube uploaded this video as private even though it was set to public/unlisted. That usually means your Google Cloud project must pass the YouTube API Services compliance audit before API uploads can be public. Change the visibility in YouTube Studio for now; ChannelDeck will not retry this.'

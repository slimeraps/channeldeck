import type { EditSpec } from '@shared/schemas/edit'
import { clipTemplateValues, type TemplateValues } from '@shared/templates'
import type { Repos } from '../db/repos'

/**
 * Template values for an edit's text: from the first piece that is a banked Twitch clip
 * (title, game, streamer, clipper, date, links, views). {{n}} is left empty here; autopost
 * rules fill it when they plan a post. An edit of plain files gets no values.
 */
export function editTemplateValues(repos: Repos, spec: EditSpec, zone: string): TemplateValues {
  for (const segment of spec.segments) {
    const clip = segment.clipId
      ? repos.clips.get(segment.clipId)
      : repos.clips.findByPath(segment.sourcePath)
    if (!clip) continue
    return clipSourceValues(repos, clip, zone)
  }
  return {}
}

export function clipSourceValues(
  repos: Repos,
  clip: NonNullable<ReturnType<Repos['clips']['get']>>,
  zone: string
): TemplateValues {
  const twitch = repos.twitchAccounts.get(clip.twitchAccountId)
  const values = clipTemplateValues(clip, {
    broadcasterName: twitch?.displayName ?? '',
    broadcasterLogin: twitch?.login ?? '',
    n: 0,
    zone
  })
  delete values.n
  return values
}

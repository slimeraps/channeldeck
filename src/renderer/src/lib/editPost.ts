import { newEdit, setLayout } from '@shared/editOps'
import type { LayoutView } from '@shared/schemas/autopost'
import type { EditSpec } from '@shared/schemas/edit'
import type { EditorSource } from '@shared/schemas/editor'
import type { MediaInfo, PostInput } from '@shared/schemas/post'

/**
 * The clip a post made from this edit is linked to (never-twice): the first banked clip, when
 * every clip in the edit comes from one Twitch channel. A mix of channels links none.
 */
export function postClipId(spec: EditSpec, sources: Map<string, EditorSource>): string | null {
  const clips = spec.segments
    .map((seg) => sources.get(seg.sourcePath))
    .filter((src): src is EditorSource => Boolean(src?.clipId))
  const channels = new Set(clips.map((c) => c.twitchAccountId))
  return channels.size === 1 ? (clips[0]?.clipId ?? null) : null
}

/**
 * The edit a post starts from when you choose "Edit video…": the post's own edit, or its video
 * with its vertical layout (if it has one) as a one-piece edit.
 */
export function startingEdit(
  input: PostInput,
  media: MediaInfo,
  layouts: readonly LayoutView[]
): EditSpec {
  if (input.edit) return input.edit
  const source = {
    path: input.filePath ?? media.path,
    durationSec: media.durationSec,
    clipId: input.clipId ?? null
  }
  if (input.render) {
    const preset = layouts.find((l) => l.id === input.render?.presetId)
    return setLayout(
      newEdit([source], 'vertical'),
      'all',
      preset
        ? { kind: preset.kind, presetId: preset.id, crops: preset.crops }
        : { kind: input.render.kind, presetId: null, crops: {} }
    )
  }
  return newEdit([source], media.height > media.width ? 'vertical' : 'horizontal')
}

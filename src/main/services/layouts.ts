import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LayoutKind } from '@shared/constants/enums'
import type { LayoutInput, LayoutView, SampleFrame } from '@shared/schemas/autopost'
import type { LayoutCrops } from '@shared/types/json'
import type { Repos } from '../db/repos'
import type { LayoutPresetRow } from '../db/repos/catalog'
import type { ClipRow } from '../db/repos/clips'
import { UserFacingError } from '../errors'
import type { MediaAccess } from '../media/access'
import type { ProbeResult } from '../media/ffprobe'
import { mediaUrl } from '../media/mediaUrl'

/**
 * Layout presets for vertical conversion (blurred fill, center crop, facecam split), plus
 * the crop editor's helpers: a sample frame from a clip, and a short test render.
 */

export interface LayoutsDeps {
  repos: Repos
  media: MediaAccess
  probe: (path: string) => Promise<ProbeResult>
  grabFrame: (args: { input: string; atSec: number; output: string }) => Promise<void>
  renderTest: (args: {
    sourcePath: string
    kind: LayoutKind
    crops: LayoutCrops
    video: { width: number; height: number; durationSec: number }
    output: string
    maxSeconds: number
  }) => Promise<void>
}

export type LayoutsService = ReturnType<typeof createLayoutsService>

export function createLayoutsService(deps: LayoutsDeps) {
  const { repos } = deps
  const rendersRoot = (): string => join(repos.settings.getKey('clipsRoot'), '_renders')

  function toView(row: LayoutPresetRow): LayoutView {
    return {
      id: row.id,
      twitchAccountId: row.twitchAccountId,
      twitchName: repos.twitchAccounts.get(row.twitchAccountId)?.displayName ?? '?',
      name: row.name,
      kind: row.kind,
      crops: row.cropsJson,
      usedByRules: repos.autopostRules.list().filter((r) => r.layoutPresetId === row.id).length
    }
  }

  function landscapeClip(twitchAccountId: number, clipId?: string): ClipRow {
    if (clipId) {
      const clip = repos.clips.get(clipId)
      if (!clip?.landscapePath || !existsSync(clip.landscapePath)) {
        throw new UserFacingError('That clip has no downloaded landscape file.')
      }
      return clip
    }
    const clip = repos.clips
      .bankFor([twitchAccountId])
      .filter((c) => c.landscapePath && existsSync(c.landscapePath))
      .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))[0]
    if (!clip) {
      throw new UserFacingError(
        'This Twitch channel has no downloaded clips yet. Wait for the first download, then try again.'
      )
    }
    return clip
  }

  return {
    list(): LayoutView[] {
      return repos.layoutPresets.list().map(toView)
    },

    save(input: LayoutInput, id?: number): LayoutView {
      if (!repos.twitchAccounts.get(input.twitchAccountId)) {
        throw new UserFacingError('That Twitch channel is no longer connected.')
      }
      const row = {
        twitchAccountId: input.twitchAccountId,
        name: input.name.trim(),
        kind: input.kind,
        cropsJson: input.kind === 'facecam_split' ? input.crops : {}
      }
      const saved = id ? repos.layoutPresets.update(id, row) : repos.layoutPresets.create(row)
      return toView(saved)
    },

    remove(id: number): { ok: true } {
      repos.layoutPresets.require(id)
      // Rules using it fall back to the blurred fill (FK: set null).
      repos.layoutPresets.remove(id)
      return { ok: true }
    },

    /** A JPEG of one frame of a landscape clip, for drawing the crop rectangles on. */
    async sampleFrame(input: {
      twitchAccountId: number
      clipId?: string | undefined
      atSec?: number | undefined
    }): Promise<SampleFrame> {
      const clip = landscapeClip(input.twitchAccountId, input.clipId)
      const path = clip.landscapePath as string
      const probe = await deps.probe(path)
      const atSec = Math.min(
        Math.max(0, input.atSec ?? Math.min(5, probe.durationSec / 2)),
        Math.max(0, probe.durationSec - 0.1)
      )
      const output = join(rendersRoot(), 'frames', `${clip.id}_${Math.round(atSec * 10)}.jpg`)
      if (!existsSync(output)) await deps.grabFrame({ input: path, atSec, output })
      deps.media.grant(output)
      return {
        clipId: clip.id,
        clipTitle: clip.title,
        frameUrl: mediaUrl(output),
        width: probe.width,
        height: probe.height,
        durationSec: probe.durationSec,
        atSec
      }
    },

    /** Renders the first few seconds of a clip with a layout, to check it before saving. */
    async testRender(input: {
      clipId: string
      kind: LayoutKind
      crops: LayoutCrops
      seconds?: number | undefined
    }): Promise<{ url: string; path: string }> {
      const clip = repos.clips.get(input.clipId)
      if (!clip?.landscapePath || !existsSync(clip.landscapePath)) {
        throw new UserFacingError('That clip has no downloaded landscape file.')
      }
      const probe = await deps.probe(clip.landscapePath)
      const output = join(rendersRoot(), 'tests', `${clip.id}_${input.kind}_test.mp4`)
      await deps.renderTest({
        sourcePath: clip.landscapePath,
        kind: input.kind,
        crops: input.crops,
        video: probe,
        output,
        maxSeconds: input.seconds ?? 8
      })
      deps.media.grant(output)
      // The URL changes per render so the player doesn't show a cached copy.
      return { url: `${mediaUrl(output)}?v=${Date.now()}`, path: output }
    }
  }
}

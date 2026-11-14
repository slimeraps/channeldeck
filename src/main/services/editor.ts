import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { type EditSpec, renderSources } from '@shared/schemas/edit'
import type { EditorRender, EditorSource, EditorStrips } from '@shared/schemas/editor'
import type { Repos } from '../db/repos'
import { editFileName, type SourceInfo } from '../domain/edit'
import { UserFacingError } from '../errors'
import type { MediaAccess } from '../media/access'
import type { ProbeResult } from '../media/ffprobe'
import { mediaUrl } from '../media/mediaUrl'

/**
 * The editor's main-process side (PLAN.md → Editor, E2): what it needs about each source
 * (probe, preview URL, the Twitch clip it is), timeline pictures (a filmstrip and a waveform,
 * made once per file and cached), and "Render now" with progress and cancel. Renders go to the
 * renders folder under a name hashed over the edit, so the same edit is never rendered twice.
 */

export interface EditorService {
  source(path: string): Promise<EditorSource>
  strips(path: string): Promise<EditorStrips>
  render(spec: EditSpec): Promise<EditorRender>
  /** Stops the render in progress, if any. */
  cancelRender(): { canceled: boolean }
  /** Shows a finished render in Finder (only files in the renders folder). */
  reveal(path: string): { revealed: boolean }
}

export interface EditorDeps {
  repos: Repos
  media: MediaAccess
  probe: (path: string) => Promise<ProbeResult>
  /** Folder for filmstrips and waveforms (also a cdmedia root). */
  cacheDir: string
  fontsDir: string
  makeFilmstrip: (args: {
    input: string
    output: string
    durationSec: number
    frames: number
  }) => Promise<void>
  filmstripFrames: (durationSec: number) => number
  makeWaveform: (args: { input: string; output: string }) => Promise<void>
  renderEdit: (args: {
    spec: EditSpec
    sources: readonly SourceInfo[]
    output: string
    fontsDir: string
    signal?: AbortSignal
    onProgress?: (fraction: number) => void
  }) => Promise<void>
  emitProgress: (fraction: number) => void
  showItemInFolder: (path: string) => void
}

export function createEditorService(deps: EditorDeps): EditorService {
  let running: AbortController | null = null
  /** Strips being made, so two requests for one file share the work. */
  const making = new Map<string, Promise<EditorStrips>>()

  async function stripsFor(path: string): Promise<EditorStrips> {
    const info = await stat(path).catch(() => null)
    if (!info) throw new UserFacingError(`File missing: ${path}`)
    const key = createHash('sha1')
      .update(`${path}|${info.size}|${Math.round(info.mtimeMs)}`)
      .digest('hex')
      .slice(0, 16)
    const dir = join(deps.cacheDir, key)
    const probe = await deps.probe(path)
    const frames = deps.filmstripFrames(probe.durationSec)
    const filmstrip = join(dir, `filmstrip-${frames}.jpg`)
    const waveform = join(dir, 'waveform.png')

    // Each picture is optional: a failure only leaves that row of the timeline plain.
    if (!existsSync(filmstrip)) {
      await deps
        .makeFilmstrip({ input: path, output: filmstrip, durationSec: probe.durationSec, frames })
        .catch(() => undefined)
    }
    if (probe.hasAudio && !existsSync(waveform)) {
      await deps.makeWaveform({ input: path, output: waveform }).catch(() => undefined)
    }
    return {
      filmstripUrl: existsSync(filmstrip) ? mediaUrl(filmstrip) : null,
      frames,
      waveformUrl: probe.hasAudio && existsSync(waveform) ? mediaUrl(waveform) : null
    }
  }

  async function renderInfo(path: string, reused: boolean): Promise<EditorRender> {
    const probe = await deps.probe(path)
    deps.media.grant(path)
    return {
      path,
      previewUrl: mediaUrl(path),
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      sizeBytes: probe.sizeBytes,
      reused
    }
  }

  return {
    async source(path) {
      const probe = await deps.probe(path)
      deps.media.grant(path)
      const clip = deps.repos.clips.findByPath(path)
      return {
        path,
        fileName: probe.fileName,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        fps: probe.fps ?? null,
        hasAudio: probe.hasAudio ?? false,
        previewUrl: mediaUrl(path),
        clipId: clip?.id ?? null,
        clipTitle: clip?.title ?? null,
        twitchAccountId: clip?.twitchAccountId ?? null
      }
    },

    strips(path) {
      const pending = making.get(path)
      if (pending) return pending
      const work = stripsFor(path).finally(() => making.delete(path))
      making.set(path, work)
      return work
    },

    async render(spec) {
      if (running)
        throw new UserFacingError('A render is already running. Wait for it or cancel it.')
      const missing = renderSources(spec).find((f) => !existsSync(f))
      if (missing) throw new UserFacingError(`File missing: ${missing} (used in the edit)`)
      const output = join(deps.repos.settings.getKey('clipsRoot'), '_renders', editFileName(spec))
      if (existsSync(output)) return renderInfo(output, true)

      const controller = new AbortController()
      running = controller
      try {
        const sources = await Promise.all(spec.segments.map((s) => deps.probe(s.sourcePath)))
        let last = 0
        deps.emitProgress(0)
        await deps.renderEdit({
          spec,
          sources,
          output,
          fontsDir: deps.fontsDir,
          signal: controller.signal,
          onProgress: (fraction) => {
            // A few updates a second is plenty for a progress bar.
            if (fraction - last >= 0.01 || fraction >= 1) {
              last = fraction
              deps.emitProgress(fraction)
            }
          }
        })
        deps.emitProgress(1)
        return await renderInfo(output, false)
      } catch (error) {
        if (controller.signal.aborted) throw new UserFacingError('Render canceled.')
        throw error
      } finally {
        running = null
      }
    },

    reveal(path) {
      const renders = resolve(deps.repos.settings.getKey('clipsRoot'), '_renders')
      const target = resolve(path)
      if (dirname(target) !== renders || !existsSync(target)) return { revealed: false }
      deps.showItemInFolder(target)
      return { revealed: true }
    },

    cancelRender() {
      if (!running) return { canceled: false }
      running.abort()
      return { canceled: true }
    }
  }
}

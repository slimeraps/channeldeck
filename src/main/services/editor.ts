import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import {
  type CaptionWord,
  type EditSpec,
  editDuration,
  fillEditText,
  isAnimatedAsset,
  overlaysOf,
  renderSources,
  STICKER_EXTENSIONS,
  styleFromSpec
} from '@shared/schemas/edit'
import type {
  EditorRender,
  EditorSource,
  EditorStrips,
  EditorAsset,
  EditProject,
  EditProjectSummary,
  EditStyle
} from '@shared/schemas/editor'
import type { Repos } from '../db/repos'
import type { EditStyleRow } from '../db/repos/catalog'
import { editFileName, type SourceInfo } from '../domain/edit'
import { UserFacingError } from '../errors'
import type { MediaAccess } from '../media/access'
import type { ProbeResult } from '../media/ffprobe'
import { mediaUrl } from '../media/mediaUrl'
import { clipSourceValues, editTemplateValues } from './editValues'

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
  /** Renders the edit (or reuses its render) and saves a copy where you choose. */
  exportFile(spec: EditSpec): Promise<{ savedTo: string | null }>
  /** Which of these clips already have a post on this channel (never-twice). */
  postedClips(accountId: number, clipIds: string[]): string[]

  listProjects(): EditProjectSummary[]
  createProject(spec: EditSpec, name?: string): Promise<EditProject>
  getProject(id: number): EditProject
  /** Autosave: stores the edit and refreshes the thumbnail if the first piece changed. */
  saveProject(id: number, spec: EditSpec): EditProject
  renameProject(id: number, name: string): EditProject
  deleteProject(id: number): Promise<void>

  /** Whether the caption model is on this Mac, and its size. */
  captionModel(): { installed: boolean; sizeBytes: number; downloading: boolean }
  /** Downloads the caption model (only after the user agreed); progress via emitModelProgress. */
  downloadCaptionModel(): Promise<void>
  cancelModelDownload(): { canceled: boolean }
  /**
   * Captions for each file: its spoken words in its own time. Each file is transcribed once
   * (cached by path, size, date and model); progress via emitCaptionProgress.
   */
  makeCaptions(paths: string[]): Promise<{ sourcePath: string; words: CaptionWord[] }[]>

  listStyles(): EditStyle[]
  /** Saves the look of an edit (text, stickers, caption style) for autopost rules. */
  saveStyle(name: string, spec: EditSpec): EditStyle
  deleteStyle(id: number): Promise<void>

  listAssets(): EditorAsset[]
  /** A library image's bytes (the preview decodes GIF frames from them). */
  assetBytes(fileName: string): Promise<Uint8Array<ArrayBuffer>>
  /** Asks for images and adds them to the sticker library (the same image is kept once). */
  importAssets(): Promise<EditorAsset[]>
  /** Removes an image, unless a project or an unfinished post still uses it. */
  deleteAsset(id: number): Promise<void>
}

export interface EditorDeps {
  repos: Repos
  media: MediaAccess
  probe: (path: string) => Promise<ProbeResult>
  /** Folder for filmstrips and waveforms (also a cdmedia root). */
  cacheDir: string
  fontsDir: string
  /** The sticker and logo library (userData/editor-assets). */
  assetsDir: string
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
    assetsDir: string
    signal?: AbortSignal
    onProgress?: (fraction: number) => void
  }) => Promise<void>
  emitProgress: (fraction: number) => void
  showItemInFolder: (path: string) => void
  /** A frame of a video as a JPEG (project thumbnails). */
  grabFrame: (args: { input: string; atSec: number; output: string }) => Promise<void>
  /** Asks where to save a file; null when canceled. */
  chooseSavePath: (defaultName: string) => Promise<string | null>
  /** Where the caption model lives (userData/models/…). */
  modelPath: string
  modelSizeBytes: number
  downloadModel: (args: {
    dest: string
    onProgress?: (fraction: number) => void
    signal?: AbortSignal
  }) => Promise<void>
  transcribe: (args: {
    input: string
    model: string
    signal?: AbortSignal
  }) => Promise<CaptionWord[]>
  emitModelProgress: (fraction: number) => void
  emitCaptionProgress: (progress: { done: number; total: number }) => void
  /** Asks for image files to import; empty when canceled. */
  chooseImages: () => Promise<string[]>
  probeImage: (path: string) => Promise<{ width: number; height: number }>
  /** Time zone for {{clip_date}} (default: the Mac's). */
  zone?: string
}

export function createEditorService(deps: EditorDeps): EditorService {
  const zone = deps.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
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

  const thumbPath = (id: number) => join(deps.cacheDir, 'projects', `${id}.jpg`)
  /** The first piece a thumbnail was made from, per project (so autosave only redoes it on change). */
  const thumbFrom = new Map<number, string>()

  function makeThumbnail(id: number, spec: EditSpec): Promise<void> {
    const first = spec.segments[0]
    if (!first || !existsSync(first.sourcePath)) return Promise.resolve()
    const key = `${first.sourcePath}|${first.inSec}`
    if (thumbFrom.get(id) === key && existsSync(thumbPath(id))) return Promise.resolve()
    thumbFrom.set(id, key)
    const atSec = first.inSec + Math.min(1, (first.outSec - first.inSec) / 2)
    return deps
      .grabFrame({ input: first.sourcePath, atSec, output: thumbPath(id) })
      .catch(() => undefined)
  }

  function toProject(row: {
    id: number
    name: string
    specJson: EditSpec
    updatedAt: string
  }): EditProject {
    return { id: row.id, name: row.name, spec: row.specJson, updatedAt: row.updatedAt }
  }

  let downloading: AbortController | null = null

  /** Cached captions for a file, keyed by path, size, date and model. */
  async function captionCacheFile(path: string): Promise<string> {
    const info = await stat(path).catch(() => null)
    if (!info) throw new UserFacingError(`File missing: ${path}`)
    const key = createHash('sha1')
      .update(`${path}|${info.size}|${Math.round(info.mtimeMs)}|${basename(deps.modelPath)}`)
      .digest('hex')
      .slice(0, 20)
    return join(deps.cacheDir, 'captions', `${key}.json`)
  }

  /** Largest image the sticker library takes. */
  const MAX_ASSET_BYTES = 20 * 1024 * 1024

  function toStyle(row: EditStyleRow, usedByRules: number): EditStyle {
    const style = row.styleJson
    return {
      id: row.id,
      name: row.name,
      canvas: style.canvas,
      texts: style.texts.length,
      stickers: style.overlays.length,
      captions: style.captions !== null,
      usedByRules
    }
  }

  function toAsset(row: {
    id: number
    name: string
    fileName: string
    width: number
    height: number
  }): EditorAsset {
    return {
      id: row.id,
      name: row.name,
      fileName: row.fileName,
      url: mediaUrl(join(deps.assetsDir, row.fileName)),
      width: row.width,
      height: row.height,
      animated: isAnimatedAsset(row.fileName)
    }
  }

  async function importAsset(path: string): Promise<EditorAsset> {
    const ext = extname(path).slice(1).toLowerCase()
    if (!(STICKER_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new UserFacingError(`${basename(path)}: stickers can be PNG, JPG, WebP or GIF.`)
    }
    const info = await stat(path)
    if (info.size > MAX_ASSET_BYTES) {
      throw new UserFacingError(`${basename(path)} is over 20 MB, too big for a sticker.`)
    }
    const bytes = await readFile(path)
    const fileName = `${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.${ext === 'jpeg' ? 'jpg' : ext}`
    const existing = deps.repos.editorAssets.findByFile(fileName)
    if (existing) return toAsset(existing)
    const target = join(deps.assetsDir, fileName)
    await mkdir(deps.assetsDir, { recursive: true })
    await copyFile(path, target)
    const size = await deps.probeImage(target).catch(async (error: unknown) => {
      await rm(target, { force: true })
      throw error
    })
    const name =
      basename(path)
        .replace(/\.[^.]+$/, '')
        .slice(0, 80) || 'Sticker'
    return toAsset(deps.repos.editorAssets.create({ name, fileName, ...size }))
  }

  /** A name for a new project: the first clip's title, or the first file's name. */
  function defaultName(spec: EditSpec): string {
    const first = spec.segments[0]
    if (!first) return 'Untitled edit'
    const clip = first.clipId
      ? deps.repos.clips.get(first.clipId)
      : deps.repos.clips.findByPath(first.sourcePath)
    const base =
      clip?.title ?? (first.sourcePath.split('/').pop() ?? 'Untitled edit').replace(/\.[^.]+$/, '')
    const name = spec.segments.length > 1 ? `${base} + ${spec.segments.length - 1} more` : base
    return name.slice(0, 80)
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

  const service: EditorService = {
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
        twitchAccountId: clip?.twitchAccountId ?? null,
        values: clip ? (clipSourceValues(deps.repos, clip, zone) as Record<string, string>) : {}
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
          // Text variables become the first clip's details ({{clip_title}}, {{game}}…).
          spec: fillEditText(spec, editTemplateValues(deps.repos, spec, zone)),
          sources,
          output,
          fontsDir: deps.fontsDir,
          assetsDir: deps.assetsDir,
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

    async exportFile(spec) {
      const rendered = await service.render(spec)
      const name = `${
        defaultName(spec)
          .replace(/[/\\:*?"<>|]+/g, ' ')
          .trim() || 'edit'
      }.mp4`
      const target = await deps.chooseSavePath(name)
      if (!target) return { savedTo: null }
      await copyFile(rendered.path, target)
      return { savedTo: target }
    },

    postedClips(accountId, clipIds) {
      const active = deps.repos.posts.activeClipIds(accountId)
      return clipIds.filter((id) => active.has(id))
    },

    listProjects() {
      return deps.repos.editProjects
        .list()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((row) => {
          const thumb = thumbPath(row.id)
          return {
            id: row.id,
            name: row.name,
            canvas: row.specJson.canvas,
            pieces: row.specJson.segments.length,
            durationSec: editDuration(row.specJson),
            thumbnailUrl: existsSync(thumb) ? mediaUrl(thumb) : null,
            updatedAt: row.updatedAt,
            missingFiles: renderSources(row.specJson).some((f) => !existsSync(f))
          }
        })
    },

    async createProject(spec, name) {
      const row = deps.repos.editProjects.create({
        name: (name ?? defaultName(spec)).trim().slice(0, 80) || 'Untitled edit',
        specJson: spec
      })
      await makeThumbnail(row.id, spec)
      return toProject(row)
    },

    getProject(id) {
      const project = toProject(deps.repos.editProjects.require(id))
      for (const path of renderSources(project.spec)) {
        if (existsSync(path)) deps.media.grant(path)
      }
      return project
    },

    saveProject(id, spec) {
      const row = deps.repos.editProjects.update(id, { specJson: spec })
      void makeThumbnail(id, spec)
      return toProject(row)
    },

    renameProject(id, name) {
      return toProject(deps.repos.editProjects.update(id, { name: name.trim().slice(0, 80) }))
    },

    async deleteProject(id) {
      deps.repos.editProjects.remove(id)
      thumbFrom.delete(id)
      await rm(thumbPath(id), { force: true })
    },

    captionModel() {
      return {
        installed: existsSync(deps.modelPath),
        sizeBytes: deps.modelSizeBytes,
        downloading: downloading !== null
      }
    },

    async downloadCaptionModel() {
      if (existsSync(deps.modelPath)) return
      if (downloading) throw new UserFacingError('The caption model is already downloading.')
      const controller = new AbortController()
      downloading = controller
      try {
        deps.emitModelProgress(0)
        await deps.downloadModel({
          dest: deps.modelPath,
          signal: controller.signal,
          onProgress: deps.emitModelProgress
        })
      } finally {
        downloading = null
      }
    },

    cancelModelDownload() {
      if (!downloading) return { canceled: false }
      downloading.abort()
      return { canceled: true }
    },

    async makeCaptions(paths) {
      if (!existsSync(deps.modelPath)) {
        throw new UserFacingError('Download the caption model first (Captions panel).')
      }
      const unique = [...new Set(paths)]
      const out: { sourcePath: string; words: CaptionWord[] }[] = []
      for (const [i, path] of unique.entries()) {
        deps.emitCaptionProgress({ done: i, total: unique.length })
        const cache = await captionCacheFile(path)
        let words: CaptionWord[]
        if (existsSync(cache)) {
          words = JSON.parse(await readFile(cache, 'utf8')) as CaptionWord[]
        } else {
          words = await deps.transcribe({ input: path, model: deps.modelPath })
          await mkdir(dirname(cache), { recursive: true })
          await writeFile(cache, JSON.stringify(words), 'utf8')
        }
        out.push({ sourcePath: path, words })
      }
      deps.emitCaptionProgress({ done: unique.length, total: unique.length })
      return out
    },

    listStyles() {
      const rules = deps.repos.autopostRules.list()
      return deps.repos.editStyles
        .list()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => toStyle(row, rules.filter((r) => r.styleId === row.id).length))
    },

    saveStyle(name, spec) {
      const style = styleFromSpec(spec)
      if (style.texts.length === 0 && style.overlays.length === 0 && !style.captions) {
        throw new UserFacingError(
          'Add some text, a sticker or captions first. A style is the look of an edit.'
        )
      }
      const trimmed = name.trim().slice(0, 80)
      const existing = deps.repos.editStyles.list().find((s) => s.name === trimmed)
      const row = existing
        ? deps.repos.editStyles.update(existing.id, { styleJson: style })
        : deps.repos.editStyles.create({ name: trimmed, styleJson: style })
      return toStyle(row, 0)
    },

    async deleteStyle(id) {
      const row = deps.repos.editStyles.require(id)
      const using = deps.repos.autopostRules.list().filter((r) => r.styleId === id)
      if (using.length > 0) {
        throw new UserFacingError(
          `"${row.name}" is used by the autopost rule "${using[0]?.name}". Pick another style there first.`
        )
      }
      deps.repos.editStyles.remove(id)
    },

    listAssets() {
      return deps.repos.editorAssets
        .list()
        .filter((row) => existsSync(join(deps.assetsDir, row.fileName)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toAsset)
    },

    async assetBytes(fileName) {
      const row = deps.repos.editorAssets.findByFile(fileName)
      if (!row) throw new UserFacingError("That image isn't in the sticker library.")
      return Uint8Array.from(await readFile(join(deps.assetsDir, row.fileName)))
    },

    async importAssets() {
      const paths = await deps.chooseImages()
      const added: EditorAsset[] = []
      const problems: string[] = []
      for (const path of paths) {
        try {
          added.push(await importAsset(path))
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error))
        }
      }
      if (problems.length > 0 && added.length === 0) throw new UserFacingError(problems.join(' '))
      return added
    },

    async deleteAsset(id) {
      const row = deps.repos.editorAssets.require(id)
      const inProject = deps.repos.editProjects
        .list()
        .find((p) => overlaysOf(p.specJson).some((o) => o.asset === row.fileName))
      if (inProject) {
        throw new UserFacingError(
          `"${row.name}" is used in the project "${inProject.name}". Remove it there first.`
        )
      }
      const inStyle = deps.repos.editStyles
        .list()
        .find((s) => s.styleJson.overlays.some((o) => o.asset === row.fileName))
      if (inStyle) {
        throw new UserFacingError(
          `"${row.name}" is used in the style "${inStyle.name}". Remove it there first.`
        )
      }
      if (deps.repos.posts.usesSticker(row.fileName)) {
        throw new UserFacingError(
          `"${row.name}" is used in a post that isn't published yet, so it stays for now.`
        )
      }
      deps.repos.editorAssets.remove(id)
      await rm(join(deps.assetsDir, row.fileName), { force: true })
    },

    cancelRender() {
      if (!running) return { canceled: false }
      running.abort()
      return { canceled: true }
    }
  }
  return service
}

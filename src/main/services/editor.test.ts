import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newEdit } from '@shared/editOps'
import { DEFAULT_TEXT_STYLE } from '@shared/schemas/edit'
import { createTestDb, seedClip, seedTwitchAccount, type TestDb } from '../../../tests/helpers/db'
import { createMediaAccess } from '../media/access'
import type { ProbeResult } from '../media/ffprobe'
import { createEditorService, type EditorDeps } from './editor'

let t: TestDb
let dir: string
let video: string

const probe = async (path: string): Promise<ProbeResult> => ({
  path,
  fileName: path.split('/').pop() ?? path,
  sizeBytes: 1000,
  mtimeMs: 1,
  durationSec: 12,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  aspectRatio: '16:9',
  isShort: false,
  isLong: false,
  fps: 60,
  hasAudio: true
})

function service(o: Partial<EditorDeps> = {}) {
  const deps: EditorDeps = {
    repos: t.repos,
    media: createMediaAccess({ roots: () => [], isReferenced: () => false }),
    probe,
    cacheDir: join(dir, 'cache'),
    fontsDir: '/fonts',
    filmstripFrames: () => 12,
    makeFilmstrip: vi.fn(async ({ output }) => {
      mkdirSync(join(output, '..'), { recursive: true })
      writeFileSync(output, 'jpg')
    }),
    makeWaveform: vi.fn(async ({ output }) => {
      mkdirSync(join(output, '..'), { recursive: true })
      writeFileSync(output, 'png')
    }),
    renderEdit: vi.fn(async ({ output }) => {
      mkdirSync(join(output, '..'), { recursive: true })
      writeFileSync(output, 'mp4')
    }),
    emitProgress: vi.fn(),
    showItemInFolder: vi.fn(),
    grabFrame: vi.fn(async ({ output }) => {
      mkdirSync(join(output, '..'), { recursive: true })
      writeFileSync(output, 'jpg')
    }),
    chooseSavePath: vi.fn(async (name: string) => {
      // A real save dialog only returns folders that exist.
      mkdirSync(join(dir, 'exports'), { recursive: true })
      return join(dir, 'exports', name)
    }),
    ...o
  }
  return { editor: createEditorService(deps), deps }
}

beforeEach(() => {
  t = createTestDb()
  dir = mkdtempSync(join(tmpdir(), 'cd-editor-'))
  video = join(dir, 'clip_landscape.mp4')
  writeFileSync(video, 'video bytes')
  t.repos.settings.update({ clipsRoot: dir })
})

afterEach(() => {
  t.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('editor service', () => {
  it('describes a source, and names the Twitch clip it is', async () => {
    const { editor } = service()
    expect(await editor.source(video)).toMatchObject({
      durationSec: 12,
      fps: 60,
      hasAudio: true,
      clipId: null,
      previewUrl: expect.stringMatching(/^cdmedia:\/\//)
    })

    const twitch = seedTwitchAccount(t.repos)
    seedClip(t.repos, twitch.id, 'clip9', { title: 'Big play' })
    t.repos.clips.setDownload('clip9', {
      downloadStatus: 'downloaded',
      landscapePath: video,
      portraitPath: null,
      fileSize: 1
    })
    expect(await editor.source(video)).toMatchObject({
      clipId: 'clip9',
      clipTitle: 'Big play',
      twitchAccountId: twitch.id
    })
  })

  it('fills text variables with the first clip before rendering', async () => {
    const twitch = seedTwitchAccount(t.repos)
    seedClip(t.repos, twitch.id, 'clip7', { title: 'Big play' })
    t.repos.clips.setDownload('clip7', {
      downloadStatus: 'downloaded',
      landscapePath: video,
      portraitPath: null,
      fileSize: 1
    })
    const { editor, deps } = service()
    expect((await editor.source(video)).values).toMatchObject({ clip_title: 'Big play' })
    const spec = newEdit([{ path: video, durationSec: 12, clipId: 'clip7' }])
    spec.texts.push({
      id: 't',
      text: '{{clip_title}} by {{broadcaster}} #{{n}} {{oops}}',
      startSec: 0,
      endSec: 2,
      x: 0.5,
      y: 0.5,
      style: DEFAULT_TEXT_STYLE,
      animation: 'none'
    })
    await editor.render(spec)
    const rendered = vi.mocked(deps.renderEdit).mock.calls[0]?.[0].spec
    expect(rendered?.texts[0]?.text).toBe(`Big play by ${twitch.displayName} # {{oops}}`)
  })

  it('makes the timeline pictures once and shares a request in progress', async () => {
    const { editor, deps } = service()
    const [a, b] = await Promise.all([editor.strips(video), editor.strips(video)])
    expect(a).toEqual(b)
    expect(a).toMatchObject({
      frames: 12,
      filmstripUrl: expect.stringMatching(/^cdmedia:/),
      waveformUrl: expect.stringMatching(/^cdmedia:/)
    })
    await editor.strips(video)
    expect(deps.makeFilmstrip).toHaveBeenCalledTimes(1)
    expect(deps.makeWaveform).toHaveBeenCalledTimes(1)
  })

  it('leaves a picture out when making it fails', async () => {
    const { editor } = service({ makeWaveform: vi.fn(async () => Promise.reject(new Error('no'))) })
    expect((await editor.strips(video)).waveformUrl).toBeNull()
  })

  it('renders into the renders folder, reusing an identical edit', async () => {
    const { editor, deps } = service()
    const spec = newEdit([{ path: video, durationSec: 12, clipId: null }])
    const first = await editor.render(spec)
    expect(first.path).toMatch(new RegExp(`^${dir}/_renders/clip_edit_[0-9a-f]{10}\\.mp4$`))
    expect(first.reused).toBe(false)
    expect(deps.emitProgress).toHaveBeenLastCalledWith(1)
    const again = await editor.render(spec)
    expect(again).toMatchObject({ path: first.path, reused: true })
    expect(deps.renderEdit).toHaveBeenCalledTimes(1)
  })

  it('runs one render at a time, and cancel stops it', async () => {
    let started: () => void = () => {}
    const begun = new Promise<void>((resolve) => (started = resolve))
    const { editor } = service({
      renderEdit: ({ signal }) =>
        new Promise((_, reject) => {
          started()
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    })
    const spec = newEdit([{ path: video, durationSec: 12, clipId: null }])
    const running = editor.render(spec)
    await begun
    await expect(editor.render({ ...spec, volume: 0.5 })).rejects.toThrow(/already running/)
    expect(editor.cancelRender()).toEqual({ canceled: true })
    await expect(running).rejects.toThrow('Render canceled.')
    expect(editor.cancelRender()).toEqual({ canceled: false })
  })

  it('refuses an edit whose file is gone', async () => {
    const { editor } = service()
    const gone = join(dir, 'gone.mp4')
    await expect(
      editor.render(newEdit([{ path: gone, durationSec: 5, clipId: null }]))
    ).rejects.toThrow(`File missing: ${gone}`)
  })

  it('shows only files in the renders folder in Finder', async () => {
    const { editor, deps } = service()
    const out = await editor.render(newEdit([{ path: video, durationSec: 12, clipId: null }]))
    expect(editor.reveal(out.path)).toEqual({ revealed: true })
    expect(editor.reveal(video)).toEqual({ revealed: false })
    expect(editor.reveal(join(dir, '_renders', '..', 'clip_landscape.mp4'))).toEqual({
      revealed: false
    })
    expect(deps.showItemInFolder).toHaveBeenCalledTimes(1)
  })

  it('keeps projects: create, list, autosave, rename and delete', async () => {
    const { editor, deps } = service()
    const spec = newEdit([{ path: video, durationSec: 12, clipId: null }])
    const project = await editor.createProject(spec)
    expect(project).toMatchObject({ name: 'clip_landscape', spec })
    expect(deps.grabFrame).toHaveBeenCalledTimes(1)

    const list = editor.listProjects()
    expect(list).toEqual([
      expect.objectContaining({
        id: project.id,
        canvas: 'vertical',
        pieces: 1,
        durationSec: 12,
        thumbnailUrl: expect.stringMatching(/^cdmedia:/),
        missingFiles: false
      })
    ])

    // Autosave: a change after the first piece's start keeps the thumbnail; trimming the
    // start makes a new one.
    editor.saveProject(project.id, { ...spec, volume: 0.5 })
    expect(editor.getProject(project.id).spec.volume).toBe(0.5)
    editor.saveProject(project.id, {
      ...spec,
      segments: [{ ...spec.segments[0]!, inSec: 4 }]
    })
    await vi.waitFor(() => expect(deps.grabFrame).toHaveBeenCalledTimes(2))

    expect(editor.renameProject(project.id, '  Best of  ').name).toBe('Best of')
    await editor.deleteProject(project.id)
    expect(editor.listProjects()).toEqual([])
    expect(() => editor.getProject(project.id)).toThrow()
  })

  it('names a joined project after its first clip', async () => {
    const twitch = seedTwitchAccount(t.repos)
    seedClip(t.repos, twitch.id, 'clip3', { title: 'Clutch' })
    const { editor } = service()
    const project = await editor.createProject(
      newEdit([
        { path: video, durationSec: 12, clipId: 'clip3' },
        { path: video, durationSec: 12, clipId: null }
      ])
    )
    expect(project.name).toBe('Clutch + 1 more')
  })

  it('exports a copy of the render where you choose, or nothing when canceled', async () => {
    const spec = newEdit([{ path: video, durationSec: 12, clipId: null }])
    const { editor } = service()
    const out = await editor.exportFile(spec)
    expect(out.savedTo).toBe(join(dir, 'exports', 'clip_landscape.mp4'))
    const { editor: canceled } = service({ chooseSavePath: async () => null })
    expect(await canceled.exportFile(spec)).toEqual({ savedTo: null })
  })

  it('lists which clips already have a post on a channel', () => {
    const { editor } = service()
    expect(editor.postedClips(1, ['a', 'b'])).toEqual([])
  })
})

import {
  AlertTriangle,
  AtSign,
  BadgeCheck,
  Check,
  Clapperboard,
  Download,
  FileVideo,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  Send,
  Sparkles,
  Sticker,
  Trash2,
  Type,
  View,
  Undo2,
  X
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  addOverlay,
  addSegment,
  addText,
  newLogoWatermark,
  newNameWatermark,
  newOverlay,
  removeOverlay,
  locate,
  newText,
  removeText,
  removeSegment,
  setCanvas,
  splitAt,
  trimIn,
  trimOut
} from '@shared/editOps'
import type { CanvasKind } from '@shared/geometry'
import {
  CANVAS_KINDS,
  type EditSegment,
  type EditSpec,
  editDuration,
  segmentDuration,
  segmentStarts
} from '@shared/schemas/edit'
import type { EditorRender } from '@shared/schemas/editor'
import type { ClipView } from '@shared/schemas/twitch'
import { ClipLibraryDialog } from '@renderer/components/post-editor/ClipLibraryDialog'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  editorKey,
  useEditorAssets,
  useEditorSources,
  useEditorStrips
} from '@renderer/hooks/useEditorSources'
import { formatClock } from '@renderer/lib/clock'
import { invoke, onEvent } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useVideoEditor } from '@renderer/stores/videoEditor'
import { AssetLibrary } from './AssetLibrary'
import { FramePanel } from './FramePanel'
import { LayoutPanel } from './LayoutPanel'
import { postClipId } from '@renderer/lib/editPost'
import { Preview } from './Preview'
import { StickerPanel } from './StickerPanel'
import { TextPanel } from './TextPanel'
import { Timeline } from './Timeline'

const CANVAS_LABEL: Record<CanvasKind, { label: string; hint: string }> = {
  vertical: { label: '9:16', hint: 'Vertical (Shorts)' },
  horizontal: { label: '16:9', hint: 'Horizontal' },
  square: { label: '1:1', hint: 'Square' }
}

/** YouTube treats vertical videos up to 3 minutes as Shorts. */
const SHORT_LIMIT_SEC = 180

type RenderState =
  | { status: 'idle' }
  | { status: 'rendering'; fraction: number }
  | { status: 'done'; result: EditorRender }

/** True when a key press is meant for a text field, not the editor's shortcuts. */
function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))
}

export function Editor({
  mode,
  title,
  onClose,
  onPost,
  onDone
}: {
  /** project: the Editor page (Post…, Export…, close). post: editing a post's video (Done, Cancel). */
  mode: 'project' | 'post'
  title?: string
  onClose: () => void
  onPost?: (spec: EditSpec, clipId: string | null) => void
  onDone?: (spec: EditSpec) => void
}): React.JSX.Element | null {
  const spec = useVideoEditor((s) => s.spec)
  const selected = useVideoEditor((s) => s.selected)
  const playhead = useVideoEditor((s) => s.playhead)
  const playing = useVideoEditor((s) => s.playing)
  const showGuides = useVideoEditor((s) => s.showGuides)
  const selectedTextId = useVideoEditor((s) => s.selectedText)
  const canUndo = useVideoEditor((s) => s.past.length > 0)
  const canRedo = useVideoEditor((s) => s.future.length > 0)
  const store = useVideoEditor.getState()
  const queryClient = useQueryClient()
  const [pickingClip, setPickingClip] = useState(false)
  const [library, setLibrary] = useState<'sticker' | 'logo' | null>(null)
  const assetList = useEditorAssets()
  const assets = new Map((assetList.data ?? []).map((a) => [a.fileName, a]))
  const selectedOverlayId = useVideoEditor((s) => s.selectedOverlay)
  const [render, setRender] = useState<RenderState>({ status: 'idle' })

  const paths = spec ? spec.segments.map((s) => s.sourcePath) : []
  const { sources, errors } = useEditorSources(paths)
  const strips = useEditorStrips(paths)
  // The keyboard handler is registered once; it reads the latest sources through this.
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  useEffect(
    () =>
      onEvent('editor:renderProgress', ({ fraction }) =>
        setRender((r) => (r.status === 'rendering' ? { status: 'rendering', fraction } : r))
      ),
    []
  )

  // Keyboard shortcuts (not while typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (typingIn(e.target)) return
      const s = useVideoEditor.getState()
      const current = s.spec
      if (!current) return
      const fps = 30
      const meta = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      let handled = true
      if (meta && key === 'z') {
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (meta) {
        handled = false
      } else if (key === ' ' || key === 'k') {
        togglePlay()
      } else if (key === 'j') {
        s.seek(s.playhead - 1)
      } else if (key === 'l') {
        s.seek(s.playhead + 1)
      } else if (key === 'arrowleft') {
        s.seek(s.playhead - (e.shiftKey ? 1 : 1 / fps))
      } else if (key === 'arrowright') {
        s.seek(s.playhead + (e.shiftKey ? 1 : 1 / fps))
      } else if (key === 's') {
        split()
      } else if (key === 'i' || key === 'o') {
        setPoint(key === 'i' ? 'in' : 'out')
      } else if (key === 'backspace' || key === 'delete') {
        if (s.selectedText) {
          s.change(removeText(current, s.selectedText))
          s.selectText(null)
        } else if (s.selectedOverlay) {
          s.change(removeOverlay(current, s.selectedOverlay))
          s.selectOverlay(null)
        } else {
          deletePiece()
        }
      } else if (key === 't') {
        addTextHere()
      } else if (key === 'escape') {
        s.selectText(null)
      } else if (key === 'home') {
        s.seek(0)
      } else if (key === 'end') {
        s.seek(editDuration(current))
      } else {
        handled = false
      }
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!spec) return null
  const total = editDuration(spec)
  const index = Math.min(selected ?? 0, spec.segments.length - 1)
  const segment = spec.segments[index] as EditSegment
  const source = sources.get(segment.sourcePath)
  const missing = [...errors.entries()]
  const selectedText = spec.texts.find((t) => t.id === selectedTextId) ?? null
  // Text variables take the first banked clip's details, as the render does.
  const clipSource = spec.segments
    .map((seg) => sources.get(seg.sourcePath))
    .find((src) => src?.clipId)
  const values = clipSource?.values ?? {}
  const selectedOverlay = (spec.overlays ?? []).find((o) => o.id === selectedOverlayId) ?? null
  const panelOpen = Boolean(selectedText ?? selectedOverlay)

  function togglePlay(): void {
    const s = useVideoEditor.getState()
    if (!s.spec) return
    if (!s.playing && s.playhead >= editDuration(s.spec) - 0.05) s.seek(0)
    s.setPlaying(!s.playing)
  }

  function split(): void {
    const s = useVideoEditor.getState()
    if (!s.spec) return
    const out = splitAt(s.spec, s.playhead)
    if (!out) {
      toast.message('Move the playhead away from the cut to split here.')
      return
    }
    s.change(out.spec)
    s.select(out.index)
  }

  /** I / O: trim the piece under the playhead so it starts or ends at the playhead. */
  function setPoint(edge: 'in' | 'out'): void {
    const s = useVideoEditor.getState()
    if (!s.spec) return
    const at = locate(s.spec, s.playhead)
    const seg = s.spec.segments[at.index] as EditSegment
    const duration = sourcesRef.current.get(seg.sourcePath)?.durationSec ?? seg.outSec
    const next =
      edge === 'in'
        ? trimIn(s.spec, at.index, at.sourceTime)
        : trimOut(s.spec, at.index, at.sourceTime, duration)
    s.change(next)
    s.select(at.index)
    if (edge === 'in') s.seek(segmentStarts(next)[at.index] ?? 0)
  }

  function addTextHere(): void {
    const s = useVideoEditor.getState()
    if (!s.spec) return
    s.setPlaying(false)
    const text = newText(s.spec, s.playhead, crypto.randomUUID())
    s.change(addText(s.spec, text))
    s.selectText(text.id)
  }

  /** The streamer's name, small, top left, for the whole video ({{broadcaster}}). */
  function addNameWatermark(): void {
    const s = useVideoEditor.getState()
    if (!s.spec) return
    const text = newNameWatermark(s.spec, crypto.randomUUID())
    s.change(addText(s.spec, text))
    s.selectText(text.id)
  }

  function deletePiece(): void {
    const s = useVideoEditor.getState()
    if (!s.spec) return
    if (s.spec.segments.length <= 1) {
      toast.message('An edit needs at least one piece.')
      return
    }
    s.change(removeSegment(s.spec, s.selected ?? 0))
  }

  async function addFromPath(path: string): Promise<void> {
    const info = await queryClient.fetchQuery({
      queryKey: [...editorKey, 'source', path],
      queryFn: () => invoke('editor:source', { path }),
      staleTime: Infinity
    })
    const s = useVideoEditor.getState()
    if (!s.spec) return
    const at = s.selected ?? s.spec.segments.length - 1
    s.change(addSegment(s.spec, { path, durationSec: info.durationSec, clipId: info.clipId }, at))
    s.select(at + 1)
  }

  async function addVideo(): Promise<void> {
    try {
      const picked = await invoke('media:pickVideo')
      if (picked) await addFromPath(picked.path)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  function addClip(clip: ClipView): void {
    setPickingClip(false)
    const path = clip.landscapePath ?? clip.portraitPath
    if (!path) {
      toast.error("That clip isn't downloaded yet.")
      return
    }
    addFromPath(path).catch((e: Error) => toast.error(e.message))
  }

  async function exportNow(): Promise<void> {
    const current = useVideoEditor.getState().spec
    if (!current) return
    useVideoEditor.getState().setPlaying(false)
    setRender({ status: 'rendering', fraction: 0 })
    try {
      const { savedTo } = await invoke('editor:export', { spec: current })
      if (savedTo) toast.success(`Saved to ${savedTo}`)
    } catch (e) {
      const message = (e as Error).message
      if (message !== 'Render canceled.') toast.error(message)
    } finally {
      setRender({ status: 'idle' })
    }
  }

  async function renderNow(): Promise<void> {
    const current = useVideoEditor.getState().spec
    if (!current) return
    useVideoEditor.getState().setPlaying(false)
    setRender({ status: 'rendering', fraction: 0 })
    try {
      const result = await invoke('editor:render', { spec: current })
      setRender({ status: 'done', result })
    } catch (e) {
      setRender({ status: 'idle' })
      const message = (e as Error).message
      if (message !== 'Render canceled.') toast.error(message)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Scissors className="size-4 text-brand" aria-hidden />
        <span className="mr-2 max-w-48 truncate text-sm font-medium">
          {title ??
            sources.get(spec.segments[0]?.sourcePath ?? '')?.clipTitle ??
            sources.get(spec.segments[0]?.sourcePath ?? '')?.fileName ??
            'Edit'}
        </span>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Canvas">
          {CANVAS_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              title={CANVAS_LABEL[kind].hint}
              aria-pressed={spec.canvas === kind}
              onClick={() => store.change(setCanvas(spec, kind))}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                spec.canvas === kind
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {CANVAS_LABEL[kind].label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          disabled={!canUndo}
          onClick={() => store.undo()}
          aria-label="Undo"
          title="Undo (⌘Z)"
        >
          <Undo2 aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={!canRedo}
          onClick={() => store.redo()}
          aria-label="Redo"
          title="Redo (⇧⌘Z)"
        >
          <Redo2 aria-hidden />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Add a piece">
              <Plus aria-hidden /> Add
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setPickingClip(true)}>
              <Clapperboard aria-hidden /> Clip from your bank…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void addVideo()}>
              <FileVideo aria-hidden /> Video file…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setLibrary('sticker')}>
              <Sticker aria-hidden /> Sticker or image…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLibrary('logo')}>
              <BadgeCheck aria-hidden /> Logo watermark…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={addNameWatermark}>
              <AtSign aria-hidden /> Channel name watermark
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" onClick={addTextHere} title="Add text (T)">
          <Type aria-hidden /> Text
        </Button>
        {spec.canvas === 'vertical' ? (
          <Button
            variant={showGuides ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={showGuides}
            onClick={() => store.toggleGuides()}
            title="Show what YouTube's Shorts player covers"
          >
            <View aria-hidden /> Guides
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {spec.canvas === 'vertical' && total > SHORT_LIMIT_SEC ? (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <AlertTriangle className="size-3.5" aria-hidden /> Over 3 minutes: not a Short
            </span>
          ) : null}
          {render.status === 'rendering' ? (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${Math.round(render.fraction * 100)}%` }}
                />
              </div>
              <span className="w-9 text-xs tabular-nums text-muted-foreground">
                {Math.round(render.fraction * 100)}%
              </span>
              <Button variant="ghost" size="sm" onClick={() => void invoke('editor:cancelRender')}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              {mode === 'project' ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void exportNow()}
                  disabled={missing.length > 0}
                  aria-label="Export…"
                  title="Export: render and save a copy where you choose"
                >
                  <Download aria-hidden />
                </Button>
              ) : null}
              <Button
                variant={mode === 'project' ? 'outline' : 'default'}
                size="sm"
                onClick={() => void renderNow()}
                disabled={missing.length > 0}
              >
                <Sparkles aria-hidden /> Render now
              </Button>
              {mode === 'project' && onPost ? (
                <Button
                  size="sm"
                  disabled={missing.length > 0}
                  onClick={() => {
                    const current = useVideoEditor.getState().spec
                    if (current) onPost(current, postClipId(current, sources))
                  }}
                >
                  <Send aria-hidden /> Post…
                </Button>
              ) : null}
            </>
          )}
          {mode === 'post' ? (
            <>
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="Cancel editing">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const current = useVideoEditor.getState().spec
                  if (current && onDone) onDone(current)
                }}
              >
                <Check aria-hidden /> Done
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close the editor">
              <X aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {missing.length > 0 ? (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {missing.map(([path, message]) => (
            <span key={path} className="truncate">
              {message}
            </span>
          ))}
        </div>
      ) : null}

      {/* Preview and inspector */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Preview spec={spec} sources={sources} values={values} assets={assets} />
          <div className="flex items-center justify-center gap-3 pb-2 text-sm">
            <Button
              variant="secondary"
              size="icon"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              title="Play / pause (Space)"
            >
              {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
            </Button>
            <span className="tabular-nums text-muted-foreground">
              {formatClock(playhead, true)} / {formatClock(total, true)}
            </span>
          </div>
        </div>
        <aside className="w-72 shrink-0 space-y-5 overflow-y-auto border-l p-4">
          {selectedText ? (
            <TextPanel spec={spec} text={selectedText} isClip={Boolean(clipSource)} />
          ) : null}
          {selectedOverlay ? (
            <StickerPanel
              spec={spec}
              overlay={selectedOverlay}
              asset={assets.get(selectedOverlay.asset)}
            />
          ) : null}
          <section className={panelOpen ? 'hidden' : 'space-y-2'}>
            <h3 className="text-sm font-medium">Piece {index + 1}</h3>
            <p className="truncate text-xs text-muted-foreground" title={segment.sourcePath}>
              {source?.clipTitle ?? source?.fileName ?? segment.sourcePath}
            </p>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Starts at</dt>
                <dd className="tabular-nums">{formatClock(segment.inSec, true)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ends at</dt>
                <dd className="tabular-nums">{formatClock(segment.outSec, true)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Length</dt>
                <dd className="tabular-nums">{formatClock(segmentDuration(segment), true)}</dd>
              </div>
            </dl>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={split}>
                <Scissors aria-hidden /> Split
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={deletePiece}
                disabled={spec.segments.length <= 1}
              >
                <Trash2 aria-hidden /> Delete
              </Button>
            </div>
          </section>
          {panelOpen ? null : spec.canvas === 'vertical' ? (
            <LayoutPanel spec={spec} index={index} source={source} />
          ) : (
            <FramePanel spec={spec} index={index} />
          )}
          <section className="space-y-1 text-xs text-muted-foreground">
            <h3 className="text-sm font-medium text-foreground">Shortcuts</h3>
            <p>Space play/pause · J/L ±1 s · ←/→ one frame</p>
            <p>S split · I/O start/end here · ⌫ delete piece or text</p>
            <p>T add text · Esc deselect text</p>
            <p>⌘Z undo · ⇧⌘Z redo · ⌘ + scroll zooms the timeline</p>
          </section>
        </aside>
      </div>

      <Timeline
        spec={spec}
        sources={sources}
        strips={strips}
        assetNames={new Map([...assets].map(([file, asset]) => [file, asset.name]))}
      />

      {library ? (
        <AssetLibrary
          purpose={library}
          onClose={() => setLibrary(null)}
          onPick={(asset) => {
            const s = useVideoEditor.getState()
            if (!s.spec) return
            const id = crypto.randomUUID()
            const overlay =
              library === 'logo'
                ? newLogoWatermark(s.spec, id, asset.fileName)
                : newOverlay(s.spec, s.playhead, id, asset.fileName)
            s.setPlaying(false)
            s.change(addOverlay(s.spec, overlay))
            s.selectOverlay(id)
            setLibrary(null)
          }}
        />
      ) : null}
      {pickingClip ? (
        <ClipLibraryDialog onPick={addClip} onClose={() => setPickingClip(false)} />
      ) : null}

      <Dialog
        open={render.status === 'done'}
        onOpenChange={(open) => !open && setRender({ status: 'idle' })}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Rendered</DialogTitle>
            <DialogDescription>
              {render.status === 'done'
                ? `${render.result.width}×${render.result.height} · ${formatClock(render.result.durationSec, true)} · ${(render.result.sizeBytes / 1_048_576).toFixed(1)} MB${render.result.reused ? ' · already rendered, reused' : ''}`
                : null}
            </DialogDescription>
          </DialogHeader>
          {render.status === 'done' ? (
            <video
              key={render.result.path}
              src={render.result.previewUrl}
              controls
              autoPlay
              className="max-h-[60vh] w-full rounded-md bg-black"
            />
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                render.status === 'done' &&
                void invoke('editor:reveal', { path: render.result.path })
              }
            >
              <FolderOpen aria-hidden /> Show in Finder
            </Button>
            <Button onClick={() => setRender({ status: 'idle' })}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {render.status === 'rendering' ? (
        <span className="sr-only" role="status">
          <Loader2 aria-hidden /> Rendering
        </span>
      ) : null}
    </div>
  )
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Captions, Download, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { captionLines, captionWordsOnTimeline, rewordLine } from '@shared/captions'
import {
  CAPTION_LOOKS,
  type CaptionStyle,
  DEFAULT_CAPTION_STYLE,
  EDIT_FONTS,
  type EditFont,
  type EditSpec
} from '@shared/schemas/edit'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { formatClock } from '@renderer/lib/clock'
import { invoke, onEvent } from '@renderer/lib/ipc'
import { useVideoEditor } from '@renderer/stores/videoEditor'
import { Segmented, Slider } from './controls'

const LOOK_LABEL: Record<(typeof CAPTION_LOOKS)[number], string> = {
  highlight: 'Highlight',
  pop: 'Pop',
  plain: 'Plain'
}

const modelKey = ['editor', 'captionModel'] as const

/**
 * Auto captions: download the speech model once (with the user's OK), make captions from
 * every video in the edit (on this Mac), then style them and fix any word.
 */
export function CaptionsPanel({ spec }: { spec: EditSpec }): React.JSX.Element {
  const qc = useQueryClient()
  const model = useQuery({ queryKey: modelKey, queryFn: () => invoke('editor:captionModel') })
  const { change, commit, seek } = useVideoEditor.getState()
  const [confirmDownload, setConfirmDownload] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [making, setMaking] = useState<{ done: number; total: number } | null>(null)

  useEffect(
    () => onEvent('editor:modelProgress', ({ fraction }) => setDownloadProgress(fraction)),
    []
  )
  useEffect(() => onEvent('editor:captionProgress', (p) => setMaking((m) => (m ? p : m))), [])

  const captions = spec.captions
  const style = captions?.style ?? DEFAULT_CAPTION_STYLE
  const megabytes = Math.round((model.data?.sizeBytes ?? 0) / 1_000_000)

  async function download(): Promise<void> {
    setDownloadProgress(0)
    try {
      await invoke('editor:downloadCaptionModel')
      toast.success('Caption model ready')
    } catch (e) {
      const message = (e as Error).message
      if (message !== 'Download canceled.') toast.error(message)
    } finally {
      setDownloadProgress(null)
      void qc.invalidateQueries({ queryKey: modelKey })
    }
  }

  async function make(): Promise<void> {
    const paths = [...new Set(spec.segments.map((s) => s.sourcePath))]
    setMaking({ done: 0, total: paths.length })
    try {
      const sources = await invoke('editor:makeCaptions', { paths })
      const s = useVideoEditor.getState()
      if (!s.spec) return
      const fresh =
        s.spec.canvas === 'vertical'
          ? DEFAULT_CAPTION_STYLE
          : { ...DEFAULT_CAPTION_STYLE, size: 64, y: 0.84 }
      s.change({
        ...s.spec,
        captions: { enabled: true, style: s.spec.captions?.style ?? fresh, sources }
      })
      const words = sources.reduce((n, src) => n + src.words.length, 0)
      if (words === 0) toast.message('No speech was found in these videos.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setMaking(null)
    }
  }

  const setStyle = (patch: Partial<CaptionStyle>, live = false) =>
    captions &&
    change({ ...spec, captions: { ...captions, style: { ...style, ...patch } } }, { live })

  // ---- not ready yet --------------------------------------------------------------------
  if (!model.data?.installed) {
    return (
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Captions className="size-4" aria-hidden /> Auto captions
        </h3>
        <p className="text-xs text-muted-foreground">
          Captions are made on your Mac with a speech model ({megabytes || 190} MB). It downloads
          once and nothing you say ever leaves your Mac.
        </p>
        {downloadProgress !== null ? (
          <div className="space-y-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.round(downloadProgress * 100)}%` }}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => void invoke('editor:cancelModelDownload')}
            >
              Cancel ({Math.round(downloadProgress * 100)}%)
            </Button>
          </div>
        ) : (
          <Button className="w-full" onClick={() => setConfirmDownload(true)}>
            <Download aria-hidden /> Download the model ({megabytes || 190} MB)
          </Button>
        )}
        <AlertDialog open={confirmDownload} onOpenChange={setConfirmDownload}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Download the caption model?</AlertDialogTitle>
              <AlertDialogDescription>
                ChannelDeck downloads whisper.cpp's English speech model (small.en,{' '}
                {megabytes || 190} MB) from its official model page on Hugging Face, checks it, and
                keeps it on this Mac. Captions are then made entirely on your Mac.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not now</AlertDialogCancel>
              <AlertDialogAction onClick={() => void download()}>Download</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    )
  }

  if (!captions) {
    return (
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Captions className="size-4" aria-hidden /> Auto captions
        </h3>
        <p className="text-xs text-muted-foreground">
          Turns what's said in every video of this edit into captions you can style and correct.
        </p>
        <Button className="w-full" onClick={() => void make()} disabled={making !== null}>
          {making ? <Loader2 className="animate-spin" aria-hidden /> : <Captions aria-hidden />}
          {making ? `Listening… ${making.done}/${making.total}` : 'Make captions'}
        </Button>
      </section>
    )
  }

  // ---- captions made --------------------------------------------------------------------
  const lines = captionLines(captionWordsOnTimeline(spec), style.maxWords)

  function reword(n: number, text: string): void {
    const line = lines[n]
    const first = line?.words[0]
    if (!line || !first || !captions || !text.trim()) return
    const sourcePath = spec.segments[first.segment]?.sourcePath
    const sources = captions.sources.map((src) =>
      src.sourcePath === sourcePath
        ? { ...src, words: rewordLine(src.words, first.index, line.words.length, text) }
        : src
    )
    change({ ...spec, captions: { ...captions, sources } })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Captions className="size-4" aria-hidden /> Captions
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={captions.enabled}
            onChange={(e) =>
              change({ ...spec, captions: { ...captions, enabled: e.target.checked } })
            }
          />
          Show
        </label>
      </div>
      <Segmented
        label="Look"
        value={style.look}
        options={CAPTION_LOOKS.map((l) => [l, LOOK_LABEL[l]] as const)}
        onChange={(look) => setStyle({ look })}
      />
      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={style.font}
          aria-label="Caption font"
          onChange={(e) => setStyle({ font: e.target.value as EditFont })}
        >
          {EDIT_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          type="color"
          value={style.color.slice(0, 7)}
          aria-label="Caption color"
          title="Caption color"
          onChange={(e) => setStyle({ color: e.target.value }, true)}
          onBlur={commit}
          className="h-8 w-9 cursor-pointer rounded-md border bg-background"
        />
        <input
          type="color"
          value={style.highlightColor.slice(0, 7)}
          aria-label="Spoken word color"
          title="Spoken word color"
          onChange={(e) => setStyle({ highlightColor: e.target.value }, true)}
          onBlur={commit}
          className="h-8 w-9 cursor-pointer rounded-md border bg-background"
        />
      </div>
      <Slider
        label="Size"
        value={style.size}
        min={24}
        max={200}
        step={2}
        onChange={(size) => setStyle({ size }, true)}
        onCommit={commit}
      />
      <Slider
        label="Outline"
        value={style.outlineWidth}
        min={0}
        max={20}
        step={1}
        onChange={(outlineWidth) => setStyle({ outlineWidth }, true)}
        onCommit={commit}
      />
      <Slider
        label="Words per line"
        value={style.maxWords}
        min={1}
        max={6}
        step={1}
        onChange={(maxWords) => setStyle({ maxWords }, true)}
        onCommit={commit}
      />
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Position</Label>
        <div className="flex gap-1">
          {(
            [
              ['Top', 0.2],
              ['Middle', 0.5],
              ['Bottom', spec.canvas === 'vertical' ? 0.66 : 0.84]
            ] as const
          ).map(([label, y]) => (
            <Button
              key={label}
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setStyle({ y })}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={style.uppercase}
          onChange={(e) => setStyle({ uppercase: e.target.checked })}
        />
        ALL CAPS
      </label>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          Words ({lines.length} line{lines.length === 1 ? '' : 's'}) · click a time to jump there
        </Label>
        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {lines.map((line, n) => (
            <div key={`${line.startSec}-${n}`} className="flex items-center gap-1.5">
              <button
                type="button"
                className="w-12 shrink-0 text-left text-[11px] text-muted-foreground tabular-nums hover:text-foreground"
                onClick={() => seek(line.startSec)}
              >
                {formatClock(line.startSec, true)}
              </button>
              <input
                className="h-7 min-w-0 flex-1 rounded border bg-background px-1.5 text-xs"
                defaultValue={line.words.map((w) => w.text).join(' ')}
                aria-label={`Caption at ${formatClock(line.startSec, true)}`}
                onBlur={(e) => {
                  const text = e.target.value
                  if (text !== line.words.map((w) => w.text).join(' ')) reword(n, text)
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            </div>
          ))}
          {lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">No speech in the pieces of this edit.</p>
          ) : null}
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => void make()}
          disabled={making !== null}
          title="Listen again, for videos added since"
        >
          {making ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}{' '}
          Remake
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => {
            const { captions: _gone, ...rest } = spec
            change(rest)
          }}
        >
          <Trash2 aria-hidden /> Remove
        </Button>
      </div>
    </section>
  )
}

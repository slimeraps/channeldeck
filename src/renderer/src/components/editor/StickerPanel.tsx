import { Trash2 } from 'lucide-react'
import { removeOverlay, retimeOverlay, updateOverlay } from '@shared/editOps'
import { type EditOverlay, type EditSpec, editDuration } from '@shared/schemas/edit'
import type { EditorAsset } from '@shared/schemas/editor'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { formatClock } from '@renderer/lib/clock'
import { useVideoEditor } from '@renderer/stores/videoEditor'
import { Slider } from './controls'

/**
 * The selected sticker or logo: size, opacity, where (or drag it on the preview) and when (or
 * drag its bar on the timeline).
 */
export function StickerPanel({
  spec,
  overlay,
  asset
}: {
  spec: EditSpec
  overlay: EditOverlay
  asset: EditorAsset | undefined
}): React.JSX.Element {
  const playhead = useVideoEditor((s) => s.playhead)
  const { change, commit, selectOverlay } = useVideoEditor.getState()
  const vertical = spec.canvas === 'vertical'
  // On a vertical video, keep corners clear of what YouTube's Shorts player covers.
  const top = vertical ? 0.12 : 0.12
  const bottom = vertical ? 0.7 : 0.86
  const left = vertical ? 0.16 : 0.1
  const right = vertical ? 0.78 : 0.9
  const places: [string, number, number][] = [
    ['Top left', left, top],
    ['Top right', right, top],
    ['Center', 0.5, 0.5],
    ['Bottom left', left, bottom],
    ['Bottom right', right, bottom]
  ]

  const live = (patch: Partial<Omit<EditOverlay, 'id'>>) =>
    change(updateOverlay(spec, overlay.id, patch), { live: true })
  const now = (patch: Partial<Omit<EditOverlay, 'id'>>) =>
    change(updateOverlay(spec, overlay.id, patch))

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Sticker</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            change(removeOverlay(spec, overlay.id))
            selectOverlay(null)
          }}
        >
          <Trash2 aria-hidden /> Delete
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <div className="grid size-14 shrink-0 place-items-center rounded-md border bg-[repeating-conic-gradient(#263241_0_25%,#161d28_0_50%)] bg-[length:12px_12px]">
          {asset ? (
            <img src={asset.url} alt="" className="max-h-12 max-w-12 object-contain" />
          ) : null}
        </div>
        <div className="min-w-0 text-xs text-muted-foreground">
          <div className="truncate text-sm text-foreground">{asset?.name ?? 'Missing image'}</div>
          {asset ? `${asset.width}×${asset.height}${asset.animated ? ' · animated' : ''}` : null}
        </div>
      </div>
      <Slider
        label="Size"
        value={Math.round(overlay.width * 100)}
        min={2}
        max={100}
        step={1}
        suffix="% of the width"
        onChange={(v) => live({ width: v / 100 })}
        onCommit={commit}
      />
      <Slider
        label="Opacity"
        value={Math.round(overlay.opacity * 100)}
        min={5}
        max={100}
        step={5}
        suffix="%"
        onChange={(v) => live({ opacity: v / 100 })}
        onCommit={commit}
      />
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Position</Label>
        <div className="grid grid-cols-3 gap-1">
          {places.map(([label, x, y]) => (
            <Button key={label} variant="outline" size="sm" onClick={() => now({ x, y })}>
              {label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Or drag it on the preview.</p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Shows</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            title="Start at the playhead"
            onClick={() => change(retimeOverlay(spec, overlay.id, 'start', playhead))}
          >
            From {formatClock(overlay.startSec, true)}
          </Button>
          <Button
            variant="outline"
            size="sm"
            title="End at the playhead"
            onClick={() => change(retimeOverlay(spec, overlay.id, 'end', playhead))}
          >
            To {formatClock(overlay.endSec, true)}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => now({ startSec: 0, endSec: editDuration(spec) })}
        >
          The whole video
        </Button>
      </div>
    </section>
  )
}

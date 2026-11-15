import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { setFrame } from '@shared/editOps'
import type { EditFrame, EditSpec } from '@shared/schemas/edit'
import { Button } from '@renderer/components/ui/button'
import { useVideoEditor } from '@renderer/stores/videoEditor'
import { Slider } from './controls'

const WHOLE: EditFrame = { zoomStart: 1, zoomEnd: 1, cx: 0.5, cy: 0.5 }

/**
 * Crop and zoom for a horizontal or square piece: how far to zoom in, an optional slow zoom
 * over the piece, and where to center (also by dragging the preview).
 */
export function FramePanel({ spec, index }: { spec: EditSpec; index: number }): React.JSX.Element {
  const { change, commit } = useVideoEditor.getState()
  const [everyPiece, setEveryPiece] = useState(false)
  const frame = spec.segments[index]?.frame ?? WHOLE
  const moving = Math.abs(frame.zoomEnd - frame.zoomStart) > 0.001

  const live = (patch: Partial<EditFrame>) =>
    change(setFrame(spec, everyPiece ? 'all' : index, { ...frame, ...patch }), { live: true })
  const now = (next: EditFrame) => change(setFrame(spec, everyPiece ? 'all' : index, next))
  const pct = (zoom: number) => Math.round(zoom * 100)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Frame</h3>
        <div className="flex items-center gap-2">
          {spec.segments.length > 1 ? (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={everyPiece}
                onChange={(e) => setEveryPiece(e.target.checked)}
              />
              Every piece
            </label>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Show the whole frame"
            title="Show the whole frame"
            onClick={() => now(WHOLE)}
          >
            <RotateCcw aria-hidden />
          </Button>
        </div>
      </div>
      <Slider
        label={moving ? 'Zoom at the start' : 'Zoom'}
        value={pct(frame.zoomStart)}
        min={100}
        max={400}
        step={5}
        suffix="%"
        onChange={(v) =>
          live(moving ? { zoomStart: v / 100 } : { zoomStart: v / 100, zoomEnd: v / 100 })
        }
        onCommit={commit}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={moving}
          onChange={(e) =>
            now(
              e.target.checked
                ? { ...frame, zoomEnd: Math.min(4, frame.zoomStart + 0.25) }
                : { ...frame, zoomEnd: frame.zoomStart }
            )
          }
        />
        Zoom slowly over the piece
      </label>
      {moving ? (
        <Slider
          label="Zoom at the end"
          value={pct(frame.zoomEnd)}
          min={100}
          max={400}
          step={5}
          suffix="%"
          onChange={(v) => live({ zoomEnd: v / 100 })}
          onCommit={commit}
        />
      ) : null}
      <Slider
        label="Left ↔ right"
        value={Math.round(frame.cx * 100)}
        min={0}
        max={100}
        step={1}
        suffix="%"
        onChange={(v) => live({ cx: v / 100 })}
        onCommit={commit}
      />
      <Slider
        label="Top ↕ bottom"
        value={Math.round(frame.cy * 100)}
        min={0}
        max={100}
        step={1}
        suffix="%"
        onChange={(v) => live({ cy: v / 100 })}
        onCommit={commit}
      />
      <p className="text-xs text-muted-foreground">
        Or drag the picture in the preview to move it.
      </p>
    </section>
  )
}

import { AlignCenter, AlignLeft, AlignRight, Trash2 } from 'lucide-react'
import { removeText, retimeText, updateText } from '@shared/editOps'
import {
  EDIT_FONTS,
  type EditFont,
  type EditSpec,
  type EditText,
  TEXT_ANIMATIONS,
  type TextStyle
} from '@shared/schemas/edit'
import { CLIP_TEMPLATE_VARS } from '@shared/templates'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { Textarea } from '@renderer/components/ui/textarea'
import { formatClock } from '@renderer/lib/clock'
import { cn } from '@renderer/lib/utils'
import { Segmented, Slider } from './controls'
import { useVideoEditor } from '@renderer/stores/videoEditor'

const ANIMATION_LABEL: Record<(typeof TEXT_ANIMATIONS)[number], string> = {
  none: 'None',
  fade: 'Fade',
  pop: 'Pop'
}

/** Variables a text can use in the editor ({{n}} only exists for autopost rules). */
const VARIABLES = CLIP_TEMPLATE_VARS.filter((v) => v.name !== 'n')

/** "#rrggbb" + an opacity 0..1 → "#rrggbbaa". */
function withAlpha(hex: string, alpha: number): string {
  return `${hex.slice(0, 7)}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`
}
const alphaOf = (hex: string): number => (hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1)

/**
 * The selected text layer: what it says, how it looks, when it shows and where. Every control
 * changes the edit live; a whole drag or typing session is one undo step (committed when the
 * control lets go or loses focus).
 */
export function TextPanel({
  spec,
  text,
  isClip
}: {
  spec: EditSpec
  text: EditText
  /** Whether the first piece is a banked clip (so {{variables}} have values). */
  isClip: boolean
}): React.JSX.Element {
  const playhead = useVideoEditor((s) => s.playhead)
  const { change, commit, selectText } = useVideoEditor.getState()
  const style = text.style

  const live = (patch: Partial<Omit<EditText, 'id'>>) =>
    change(updateText(spec, text.id, patch), { live: true })
  const liveStyle = (patch: Partial<TextStyle>) => live({ style: { ...style, ...patch } })
  const now = (patch: Partial<Omit<EditText, 'id'>>) => change(updateText(spec, text.id, patch))
  const nowStyle = (patch: Partial<TextStyle>) => now({ style: { ...style, ...patch } })
  const done = { onBlur: commit, onPointerUp: commit, onKeyUp: commit }

  const look: 'outline' | 'box' | 'none' = style.box
    ? 'box'
    : style.outlineWidth > 0
      ? 'outline'
      : 'none'

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Text</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            change(removeText(spec, text.id))
            selectText(null)
          }}
        >
          <Trash2 aria-hidden /> Delete
        </Button>
      </div>

      <Textarea
        value={text.text}
        rows={2}
        aria-label="Text"
        onChange={(e) => e.target.value.trim() && live({ text: e.target.value })}
        onBlur={commit}
        className="resize-none"
      />
      <select
        className="h-8 w-full rounded-md border bg-background px-2 text-xs text-muted-foreground"
        value=""
        aria-label="Insert a clip detail"
        onChange={(e) => e.target.value && now({ text: `${text.text} {{${e.target.value}}}` })}
      >
        <option value="">Insert a clip detail…</option>
        {VARIABLES.map((v) => (
          <option key={v.name} value={v.name}>
            {v.label}
          </option>
        ))}
      </select>
      {!isClip && text.text.includes('{{') ? (
        <p className="text-xs text-amber-400">
          This edit doesn't start with a clip from your bank, so clip details stay empty.
        </p>
      ) : null}

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={style.font}
          aria-label="Font"
          onChange={(e) => nowStyle({ font: e.target.value as EditFont })}
          style={{ fontFamily: `"${style.font}"` }}
        >
          {EDIT_FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
              {f}
            </option>
          ))}
        </select>
        <input
          type="color"
          value={style.color.slice(0, 7)}
          aria-label="Text color"
          onChange={(e) => liveStyle({ color: e.target.value })}
          {...done}
          className="h-8 w-10 cursor-pointer rounded-md border bg-background"
        />
      </div>

      <Slider
        label="Size"
        value={style.size}
        min={16}
        max={400}
        step={2}
        onChange={(v) => liveStyle({ size: v })}
        onCommit={commit}
      />

      <div className="space-y-2">
        <Segmented
          label="Look"
          value={look}
          options={[
            ['outline', 'Outline'],
            ['box', 'Box'],
            ['none', 'Plain']
          ]}
          onChange={(v) =>
            nowStyle(
              v === 'box'
                ? { box: true }
                : v === 'outline'
                  ? { box: false, outlineWidth: style.outlineWidth || 8 }
                  : { box: false, outlineWidth: 0 }
            )
          }
        />
        {look === 'outline' ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Slider
                label="Outline"
                value={style.outlineWidth}
                min={1}
                max={30}
                step={1}
                onChange={(v) => liveStyle({ outlineWidth: v })}
                onCommit={commit}
              />
            </div>
            <input
              type="color"
              value={style.outlineColor.slice(0, 7)}
              aria-label="Outline color"
              onChange={(e) => liveStyle({ outlineColor: e.target.value })}
              {...done}
              className="h-8 w-10 cursor-pointer rounded-md border bg-background"
            />
          </div>
        ) : null}
        {look === 'box' ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Slider
                label="Box opacity"
                value={Math.round(alphaOf(style.boxColor) * 100)}
                min={10}
                max={100}
                step={5}
                suffix="%"
                onChange={(v) => liveStyle({ boxColor: withAlpha(style.boxColor, v / 100) })}
                onCommit={commit}
              />
            </div>
            <input
              type="color"
              value={style.boxColor.slice(0, 7)}
              aria-label="Box color"
              onChange={(e) =>
                liveStyle({ boxColor: withAlpha(e.target.value, alphaOf(style.boxColor)) })
              }
              {...done}
              className="h-8 w-10 cursor-pointer rounded-md border bg-background"
            />
          </div>
        ) : null}
        <Slider
          label="Shadow"
          value={style.shadow}
          min={0}
          max={30}
          step={1}
          onChange={(v) => liveStyle({ shadow: v })}
          onCommit={commit}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Alignment">
          {(
            [
              ['left', AlignLeft],
              ['center', AlignCenter],
              ['right', AlignRight]
            ] as const
          ).map(([align, Icon]) => (
            <button
              key={align}
              type="button"
              aria-label={`Align ${align}`}
              aria-pressed={style.align === align}
              onClick={() => nowStyle({ align })}
              className={cn(
                'rounded p-1',
                style.align === align ? 'bg-muted text-foreground' : 'text-muted-foreground'
              )}
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>
        <Segmented
          value={text.animation}
          options={TEXT_ANIMATIONS.map((a) => [a, ANIMATION_LABEL[a]] as const)}
          onChange={(v) => now({ animation: v })}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Position</Label>
        <div className="flex gap-1">
          {(
            [
              ['Top', 0.15],
              ['Middle', 0.5],
              ['Bottom', 0.72]
            ] as const
          ).map(([label, y]) => (
            <Button
              key={label}
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => now({ x: 0.5, y })}
            >
              {label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Or drag the text on the preview.</p>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Shows</Label>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Button
            variant="outline"
            size="sm"
            title="Start at the playhead"
            onClick={() => change(retimeText(spec, text.id, 'start', playhead))}
          >
            From {formatClock(text.startSec, true)}
          </Button>
          <Button
            variant="outline"
            size="sm"
            title="End at the playhead"
            onClick={() => change(retimeText(spec, text.id, 'end', playhead))}
          >
            To {formatClock(text.endSec, true)}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Click to move the start or end to the playhead, or drag the text on the timeline.
        </p>
      </div>
    </section>
  )
}

import { Check, LayoutTemplate, Plus } from 'lucide-react'
import { useState } from 'react'
import { setLayout } from '@shared/editOps'
import type { EditLayout, EditSpec } from '@shared/schemas/edit'
import type { EditorSource } from '@shared/schemas/editor'
import type { LayoutView } from '@shared/schemas/autopost'
import { LayoutEditor } from '@renderer/components/autopost/LayoutEditor'
import { Button } from '@renderer/components/ui/button'
import { useLayouts } from '@renderer/hooks/useAutopost'
import { cn } from '@renderer/lib/utils'
import { useVideoEditor } from '@renderer/stores/videoEditor'

const KIND_LABEL = {
  blur_fill: 'Blurred fill',
  center_crop: 'Center crop',
  facecam_split: 'Facecam split'
} as const

const BUILT_IN: { kind: 'blur_fill' | 'center_crop'; hint: string }[] = [
  { kind: 'blur_fill', hint: 'The whole clip over a blurred copy' },
  { kind: 'center_crop', hint: 'The middle of the clip, full height' }
]

/**
 * Vertical layout for the selected piece (or every piece): the built-in layouts, the saved
 * layouts of the clip's Twitch channel, or a new one drawn right here on this clip.
 */
export function LayoutPanel({
  spec,
  index,
  source
}: {
  spec: EditSpec
  index: number
  source: EditorSource | undefined
}): React.JSX.Element {
  const layouts = useLayouts()
  const change = useVideoEditor((s) => s.change)
  const [everyPiece, setEveryPiece] = useState(spec.segments.length === 1)
  const [creating, setCreating] = useState(false)
  const segment = spec.segments[index]
  const current = segment?.layout ?? null
  const twitchId = source?.twitchAccountId ?? null
  const saved = (layouts.data ?? []).filter(
    (l) => twitchId === null || l.twitchAccountId === twitchId
  )

  function apply(layout: EditLayout | null): void {
    change(setLayout(spec, everyPiece ? 'all' : index, layout))
  }

  const fromPreset = (l: LayoutView): EditLayout => ({
    kind: l.kind,
    presetId: l.id,
    crops: l.crops
  })

  const isBuiltIn = (kind: string) =>
    (current === null && kind === 'blur_fill') ||
    (current !== null && current.presetId === null && current.kind === kind)

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Layout</h3>
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
      </div>
      <div className="space-y-1">
        {BUILT_IN.map((b) => (
          <Option
            key={b.kind}
            label={KIND_LABEL[b.kind]}
            hint={b.hint}
            active={isBuiltIn(b.kind)}
            onClick={() => apply({ kind: b.kind, presetId: null, crops: {} })}
          />
        ))}
        {saved.map((l) => (
          <Option
            key={l.id}
            label={l.name}
            hint={`${KIND_LABEL[l.kind]}${twitchId === null ? ` · ${l.twitchName}` : ''}`}
            color={l.twitchColor}
            active={current?.presetId === l.id}
            onClick={() => apply(fromPreset(l))}
          />
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={twitchId === null}
        title={
          twitchId === null
            ? 'Layouts are drawn on a Twitch clip from your clip bank.'
            : 'Draw a layout on this clip and save it'
        }
        onClick={() => setCreating(true)}
      >
        <Plus aria-hidden /> New layout…
      </Button>
      {twitchId === null && saved.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          This video isn't from your clip bank, so every saved layout is listed.
        </p>
      ) : null}
      {creating && twitchId !== null ? (
        <LayoutEditor
          layout={null}
          defaultTwitchAccountId={twitchId}
          {...(source?.clipId ? { initialClipId: source.clipId } : {})}
          onClose={() => setCreating(false)}
          onSaved={(layout) => {
            setCreating(false)
            apply(fromPreset(layout))
          }}
        />
      ) : null}
    </section>
  )
}

function Option({
  label,
  hint,
  active,
  color,
  onClick
}: {
  label: string
  hint: string
  active: boolean
  color?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors',
        active ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted'
      )}
      aria-pressed={active}
    >
      <LayoutTemplate
        className="size-4 shrink-0"
        style={color ? { color } : undefined}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      {active ? <Check className="size-4 text-primary" aria-hidden /> : null}
    </button>
  )
}

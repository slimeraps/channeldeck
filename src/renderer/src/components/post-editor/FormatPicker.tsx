import { useMutation } from '@tanstack/react-query'
import { Clapperboard, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { LayoutKind } from '@shared/constants/enums'
import type { MediaInfo, PostDetail, PostInput } from '@shared/schemas/post'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useLayouts } from '@renderer/hooks/useAutopost'
import { invoke } from '@renderer/lib/ipc'

/**
 * Horizontal or vertical. A Twitch clip post can use its horizontal file, Twitch's own
 * vertical version, or a vertical render of the horizontal file with a layout; your own
 * horizontal videos can be rendered vertical too. The render happens on upload, or now with
 * "Render now" (the upload then reuses it).
 */

type Choice =
  | { key: 'horizontal' }
  | { key: 'twitch' }
  | { key: 'layout'; kind: LayoutKind; presetId: number | null }

const KIND_LABEL: Record<LayoutKind, string> = {
  blur_fill: 'Blurred fill',
  center_crop: 'Center crop',
  facecam_split: 'Facecam split'
}

function keyOf(c: Choice): string {
  return c.key === 'layout' ? `layout:${c.presetId ?? c.kind}` : c.key
}

export function FormatPicker({
  input,
  media,
  clip,
  disabled,
  onChoose
}: {
  input: PostInput
  media: MediaInfo | null
  clip: PostDetail['clip']
  disabled?: boolean
  /** Switch the video (null = keep it) and/or the render. */
  onChoose: (next: { filePath: string | null; render: PostInput['render'] }) => void
}): React.JSX.Element | null {
  const layouts = useLayouts()
  const [rendered, setRendered] = useState<MediaInfo | null>(null)
  const renderNow = useMutation({
    mutationFn: (render: NonNullable<PostInput['render']>) =>
      invoke('posts:renderVertical', {
        sourcePath: input.filePath as string,
        kind: render.kind,
        presetId: render.presetId
      }),
    onSuccess: (info) => setRendered(info),
    onError: (e) => toast.error(e.message)
  })

  const source = clip?.landscapePath ?? (media && media.width > media.height ? media.path : null)
  // Nothing to choose: a vertical video of your own, or no video yet.
  if (!source && !clip?.portraitPath) return null

  const presets = (layouts.data ?? []).filter(
    (l) => !clip || l.twitchAccountId === clip.twitchAccountId
  )
  const options: { choice: Choice; label: string }[] = [
    ...(source
      ? [{ choice: { key: 'horizontal' } as Choice, label: 'Horizontal (as filmed)' }]
      : []),
    ...(clip?.portraitPath
      ? [{ choice: { key: 'twitch' } as Choice, label: 'Vertical: Twitch’s version' }]
      : []),
    ...(source
      ? [
          ...(['blur_fill', 'center_crop'] as const).map((kind) => ({
            choice: { key: 'layout', kind, presetId: null } as Choice,
            label: `Vertical: ${KIND_LABEL[kind]}`
          })),
          ...presets.map((l) => ({
            choice: { key: 'layout', kind: l.kind, presetId: l.id } as Choice,
            label: `Vertical: ${l.name}`
          }))
        ]
      : [])
  ]

  const current: Choice = input.render
    ? { key: 'layout', kind: input.render.kind, presetId: input.render.presetId }
    : clip?.portraitPath && input.filePath === clip.portraitPath
      ? { key: 'twitch' }
      : { key: 'horizontal' }

  function choose(key: string): void {
    const option = options.find((o) => keyOf(o.choice) === key)
    if (!option) return
    setRendered(null)
    const c = option.choice
    if (c.key === 'twitch') onChoose({ filePath: clip?.portraitPath ?? null, render: null })
    else if (c.key === 'horizontal') onChoose({ filePath: source, render: null })
    else onChoose({ filePath: source, render: { kind: c.kind, presetId: c.presetId } })
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm">Format</span>
        <Select value={keyOf(current)} onValueChange={choose} disabled={disabled}>
          <SelectTrigger size="sm" className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={keyOf(o.choice)} value={keyOf(o.choice)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {input.render ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Uploads as a 1080×1920 Short, made from the horizontal video when it uploads. Render it
            now to check it first.
          </p>
          {rendered ? (
            <video
              key={rendered.previewUrl}
              src={rendered.previewUrl}
              controls
              className="mx-auto aspect-[9/16] max-h-80 rounded-md bg-black"
            />
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || renderNow.isPending || !input.filePath}
            onClick={() => input.render && renderNow.mutate(input.render)}
          >
            {renderNow.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Clapperboard aria-hidden />
            )}
            {renderNow.isPending ? 'Rendering…' : rendered ? 'Rendered' : 'Render now'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

import { Clapperboard, ImageOff, Loader2, RefreshCw } from 'lucide-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { LayoutKind } from '@shared/constants/enums'
import { type LayoutView, layoutInputSchema, type SampleFrame } from '@shared/schemas/autopost'
import type { CropRect, LayoutCrops } from '@shared/types/json'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useSaveLayout } from '@renderer/hooks/useAutopost'
import { useTwitchAccounts } from '@renderer/hooks/useTwitch'
import { invoke } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'

const KINDS: { value: LayoutKind; label: string; hint: string }[] = [
  {
    value: 'blur_fill',
    label: 'Blurred fill',
    hint: 'The whole clip in the middle, over a blurred copy.'
  },
  { value: 'center_crop', label: 'Center crop', hint: 'Just the middle of the clip, full height.' },
  {
    value: 'facecam_split',
    label: 'Facecam split',
    hint: 'Your facecam on top, the gameplay below. Draw both boxes.'
  }
]

type Region = 'facecam' | 'gameplay'
const REGION_STYLE: Record<Region, string> = {
  facecam: 'border-rose-500 bg-rose-500/15',
  gameplay: 'border-sky-500 bg-sky-500/15'
}

/** Same band height the renderer uses (main/domain/render.ts): facecam shape, 480–960 px. */
function bandHeight(facecam: CropRect): number {
  const natural = (1080 * facecam.height) / Math.max(1, facecam.width)
  return Math.min(960, Math.max(480, natural))
}

function defaultCrops(width: number, height: number): LayoutCrops {
  const camW = Math.round(width * 0.25)
  return {
    facecam: { x: width - camW, y: 0, width: camW, height: Math.round((camW * 9) / 16) },
    gameplay: { x: Math.round(width * 0.2), y: 0, width: Math.round(width * 0.6), height },
    sourceWidth: width,
    sourceHeight: height
  }
}

/** Draws `src` (a rectangle of the image) to cover the destination box. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  src: CropRect,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const scale = Math.max(dw / src.width, dh / src.height)
  const sw = dw / scale
  const sh = dh / scale
  ctx.drawImage(
    img,
    src.x + (src.width - sw) / 2,
    src.y + (src.height - sh) / 2,
    sw,
    sh,
    dx,
    dy,
    dw,
    dh
  )
}

function PreviewCanvas({
  frame,
  kind,
  crops
}: {
  frame: SampleFrame | null
  kind: LayoutKind
  crops: LayoutCrops
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!frame) return
    const image = new Image()
    image.onload = () => setImg(image)
    image.src = frame.frameUrl
  }, [frame])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !img || !frame) return
    const W = canvas.width
    const H = canvas.height
    const k = W / 1080
    const full = { x: 0, y: 0, width: frame.width, height: frame.height }
    ctx.clearRect(0, 0, W, H)
    if (kind === 'facecam_split' && crops.facecam && crops.gameplay) {
      const top = bandHeight(crops.facecam) * k
      drawCover(ctx, img, crops.facecam, 0, 0, W, top)
      drawCover(ctx, img, crops.gameplay, 0, top, W, H - top)
    } else if (kind === 'center_crop') {
      const w = Math.min(frame.width, (frame.height * 9) / 16)
      drawCover(
        ctx,
        img,
        { x: (frame.width - w) / 2, y: 0, width: w, height: frame.height },
        0,
        0,
        W,
        H
      )
    } else {
      ctx.filter = 'blur(10px) brightness(0.9)'
      drawCover(ctx, img, full, -20, -20, W + 40, H + 40)
      ctx.filter = 'none'
      const h = (W * frame.height) / frame.width
      ctx.drawImage(img, 0, (H - h) / 2, W, h)
    }
  }, [img, frame, kind, crops])

  return (
    <canvas
      ref={canvasRef}
      width={216}
      height={384}
      className="rounded-md border bg-black"
      aria-label="Vertical preview"
    />
  )
}

function CropCanvas({
  frame,
  crops,
  active,
  onChange
}: {
  frame: SampleFrame
  crops: LayoutCrops
  active: Region
  onChange: (crops: LayoutCrops) => void
}): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    mode: 'draw' | 'move'
    start: { x: number; y: number }
    origin: CropRect
  } | null>(null)

  function point(e: React.PointerEvent): { x: number; y: number } {
    const rect = (boxRef.current as HTMLDivElement).getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * frame.width
    const y = ((e.clientY - rect.top) / rect.height) * frame.height
    return {
      x: Math.min(frame.width, Math.max(0, x)),
      y: Math.min(frame.height, Math.max(0, y))
    }
  }

  function set(rect: CropRect): void {
    onChange({ ...crops, [active]: rect, sourceWidth: frame.width, sourceHeight: frame.height })
  }

  function onDown(e: React.PointerEvent): void {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = point(e)
    const current = crops[active]
    const inside =
      current &&
      p.x >= current.x &&
      p.x <= current.x + current.width &&
      p.y >= current.y &&
      p.y <= current.y + current.height
    drag.current = {
      mode: inside ? 'move' : 'draw',
      start: p,
      origin: current ?? { x: p.x, y: p.y, width: 1, height: 1 }
    }
  }

  function onMove(e: React.PointerEvent): void {
    const d = drag.current
    if (!d) return
    const p = point(e)
    if (d.mode === 'move') {
      const x = Math.min(frame.width - d.origin.width, Math.max(0, d.origin.x + p.x - d.start.x))
      const y = Math.min(frame.height - d.origin.height, Math.max(0, d.origin.y + p.y - d.start.y))
      set({ ...d.origin, x: Math.round(x), y: Math.round(y) })
    } else {
      set({
        x: Math.round(Math.min(d.start.x, p.x)),
        y: Math.round(Math.min(d.start.y, p.y)),
        width: Math.max(16, Math.round(Math.abs(p.x - d.start.x))),
        height: Math.max(16, Math.round(Math.abs(p.y - d.start.y)))
      })
    }
  }

  const pct = (r: CropRect): React.CSSProperties => ({
    left: `${(r.x / frame.width) * 100}%`,
    top: `${(r.y / frame.height) * 100}%`,
    width: `${(r.width / frame.width) * 100}%`,
    height: `${(r.height / frame.height) * 100}%`
  })

  return (
    <div
      ref={boxRef}
      className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-md border select-none"
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
    >
      <img src={frame.frameUrl} alt="" className="absolute inset-0 size-full" draggable={false} />
      {(['gameplay', 'facecam'] as const).map((region) => {
        const r = crops[region]
        if (!r) return null
        return (
          <div
            key={region}
            className={cn(
              'pointer-events-none absolute border-2',
              REGION_STYLE[region],
              region !== active && 'opacity-50'
            )}
            style={pct(r)}
          >
            <span className="absolute top-0 left-0 bg-black/70 px-1 text-[10px] text-white capitalize">
              {region}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function LayoutEditor({
  layout,
  defaultTwitchAccountId,
  onClose,
  onSaved
}: {
  layout: LayoutView | null
  defaultTwitchAccountId?: number
  onClose: () => void
  onSaved?: (layout: LayoutView) => void
}): React.JSX.Element {
  const twitch = useTwitchAccounts()
  const save = useSaveLayout()
  const [twitchAccountId, setTwitchAccountId] = useState<number | null>(
    layout?.twitchAccountId ?? defaultTwitchAccountId ?? null
  )
  const [name, setName] = useState(layout?.name ?? '')
  const [kind, setKind] = useState<LayoutKind>(layout?.kind ?? 'facecam_split')
  const [drawn, setCrops] = useState<LayoutCrops>(layout?.crops ?? {})
  const [active, setActive] = useState<Region>('facecam')
  const [frameAt, setFrameAt] = useState<{ clipId?: string; atSec?: number }>({})
  const [rendering, setRendering] = useState(false)
  const [testUrl, setTestUrl] = useState<string | null>(null)

  const accountId = twitchAccountId ?? twitch.data?.[0]?.id ?? null

  const frameQuery = useQuery({
    queryKey: ['layouts', 'frame', accountId, frameAt.clipId, frameAt.atSec],
    queryFn: () =>
      invoke('layouts:sampleFrame', {
        twitchAccountId: accountId as number,
        ...(frameAt.clipId ? { clipId: frameAt.clipId } : {}),
        ...(frameAt.atSec !== undefined ? { atSec: frameAt.atSec } : {})
      }),
    enabled: accountId !== null,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: Infinity
  })
  const frame: SampleFrame | null = frameQuery.data ?? null
  const frameError = frameQuery.error ? frameQuery.error.message : null
  // Until you draw, start from sensible boxes for this frame size.
  const crops: LayoutCrops =
    drawn.facecam && drawn.gameplay
      ? drawn
      : frame
        ? defaultCrops(frame.width, frame.height)
        : drawn

  const parsed = layoutInputSchema.safeParse({
    twitchAccountId: accountId ?? 0,
    name,
    kind,
    crops: kind === 'facecam_split' ? crops : {}
  })

  async function testRender(): Promise<void> {
    if (!frame) return
    setRendering(true)
    try {
      const out = await invoke('layouts:testRender', {
        clipId: frame.clipId,
        kind,
        crops: kind === 'facecam_split' ? crops : {}
      })
      setTestUrl(out.url)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRendering(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{layout ? `Edit layout “${layout.name}”` : 'New layout'}</DialogTitle>
          <DialogDescription>
            How a landscape clip becomes a 1080×1920 Short when Twitch has no portrait version.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-[1fr_216px]">
          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="layout-name">Name</Label>
                <Input
                  id="layout-name"
                  value={name}
                  placeholder="Cam top right"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Twitch channel</Label>
                <Select
                  value={accountId ? String(accountId) : ''}
                  onValueChange={(v) => {
                    setTwitchAccountId(Number(v))
                    setFrameAt({})
                  }}
                  disabled={Boolean(layout)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick a channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {(twitch.data ?? []).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <RadioGroup
              value={kind}
              onValueChange={(v) => setKind(v as LayoutKind)}
              className="grid gap-2 sm:grid-cols-3"
            >
              {KINDS.map((k) => (
                <label
                  key={k.value}
                  className={cn(
                    'flex cursor-pointer gap-2 rounded-md border p-3 text-sm',
                    kind === k.value && 'border-primary bg-primary/5'
                  )}
                >
                  <RadioGroupItem value={k.value} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{k.label}</span>
                    <span className="block text-xs text-muted-foreground">{k.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>

            {frameError ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                <ImageOff className="size-5 shrink-0" aria-hidden />
                {frameError}
              </div>
            ) : frame ? (
              <div className="space-y-2">
                {kind === 'facecam_split' ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Drawing:</span>
                      {(['facecam', 'gameplay'] as const).map((r) => (
                        <Button
                          key={r}
                          size="sm"
                          variant={active === r ? 'default' : 'outline'}
                          onClick={() => setActive(r)}
                          className="capitalize"
                        >
                          <span
                            className={cn(
                              'size-2 rounded-full',
                              r === 'facecam' ? 'bg-rose-500' : 'bg-sky-500'
                            )}
                          />
                          {r}
                        </Button>
                      ))}
                      <span className="text-xs text-muted-foreground">
                        Drag to draw a box; drag inside it to move it.
                      </span>
                    </div>
                    <CropCanvas frame={frame} crops={crops} active={active} onChange={setCrops} />
                  </>
                ) : (
                  <img
                    src={frame.frameUrl}
                    alt=""
                    className="w-full rounded-md border"
                    style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
                  />
                )}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {frame.clipTitle} · {frame.atSec.toFixed(1)} s
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={frameQuery.isFetching}
                    onClick={() =>
                      setFrameAt({
                        clipId: frame.clipId,
                        atSec: (frame.atSec + 7) % Math.max(1, frame.durationSec - 0.5)
                      })
                    }
                  >
                    <RefreshCw aria-hidden /> Another moment
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Grabbing a frame…
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Label>Short preview</Label>
            {testUrl ? (
              <video
                key={testUrl}
                src={testUrl}
                controls
                autoPlay
                className="aspect-[9/16] w-[216px] rounded-md border bg-black"
              />
            ) : (
              <PreviewCanvas frame={frame} kind={kind} crops={crops} />
            )}
            <Button
              variant="outline"
              className="w-full"
              disabled={!frame || rendering || (kind === 'facecam_split' && !parsed.success)}
              onClick={() => void testRender()}
            >
              {rendering ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Clapperboard aria-hidden />
              )}
              {rendering ? 'Rendering…' : 'Test render (8 s)'}
            </Button>
            {testUrl ? (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setTestUrl(null)}>
                Back to the still preview
              </Button>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          {!parsed.success ? (
            <p className="mr-auto self-center text-xs text-muted-foreground">
              {parsed.error.issues[0]?.message}
            </p>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!parsed.success || save.isPending}
            onClick={() =>
              parsed.success &&
              save.mutate(
                { ...(layout ? { id: layout.id } : {}), input: parsed.data },
                {
                  onSuccess: (saved) => {
                    onSaved?.(saved)
                    onClose()
                  }
                }
              )
            }
          >
            Save layout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

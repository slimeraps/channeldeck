import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Scissors, Undo2 } from 'lucide-react'
import { useEffect } from 'react'
import { type EditSpec, editDuration } from '@shared/schemas/edit'
import { Editor } from '@renderer/components/editor/Editor'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { formatClock } from '@renderer/lib/clock'
import { invoke } from '@renderer/lib/ipc'
import { useVideoEditor } from '@renderer/stores/videoEditor'

const CANVAS_LABEL = { vertical: '9:16', horizontal: '16:9', square: '1:1' } as const

/** What the post's edit is, with Edit video… and Remove edit (in place of the Format switch). */
export function EditedVideoCard({
  edit,
  accountId,
  clipId,
  disabled,
  onEdit,
  onRemove
}: {
  edit: EditSpec
  accountId: number | null
  clipId: string | null
  disabled: boolean
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  // Never-twice covers the post's own clip; warn about the other clips joined into it.
  const others = [
    ...new Set(edit.segments.flatMap((s) => (s.clipId && s.clipId !== clipId ? [s.clipId] : [])))
  ]
  const posted = useQuery({
    queryKey: ['editor', 'postedClips', accountId, others],
    queryFn: () =>
      invoke('editor:postedClips', { accountId: accountId as number, clipIds: others }),
    enabled: accountId !== null && others.length > 0
  })
  const already = posted.data?.length ?? 0
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-sm">
        <Scissors className="size-4 text-brand" aria-hidden />
        <span className="font-medium">Edited video</span>
        <span className="text-muted-foreground">
          {CANVAS_LABEL[edit.canvas]} · {formatClock(editDuration(edit), true)} ·{' '}
          {edit.segments.length} piece{edit.segments.length === 1 ? '' : 's'}
          {edit.texts.length
            ? ` · ${edit.texts.length} text${edit.texts.length === 1 ? '' : 's'}`
            : ''}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        The edit is rendered just before the upload. The preview above shows its first video.
      </p>
      {already > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {already} other clip{already === 1 ? ' in this edit is' : 's in this edit are'} already
          posted to this channel.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={disabled} onClick={onEdit}>
          <Scissors aria-hidden /> Edit video…
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>
          <Undo2 aria-hidden /> Remove edit
        </Button>
      </div>
    </div>
  )
}

/**
 * The video editor over the post editor. Done hands the edit back to the post; Cancel leaves
 * the post as it was.
 */
export function VideoEditorOverlay({
  initial,
  onDone,
  onCancel
}: {
  initial: EditSpec
  onDone: (spec: EditSpec) => void
  onCancel: () => void
}): React.JSX.Element {
  useEffect(() => {
    useVideoEditor.getState().open(initial, { kind: 'post' })
    return () => useVideoEditor.getState().close()
    // Opened once per overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const ready = useVideoEditor((s) => s.origin?.kind === 'post' && s.spec !== null)
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="flex h-[94vh] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Edit video</DialogTitle>
        <DialogDescription className="sr-only">
          Trim, join, frame and add text to this post's video.
        </DialogDescription>
        {ready ? (
          <Editor mode="post" title="Edit this post's video" onClose={onCancel} onDone={onDone} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

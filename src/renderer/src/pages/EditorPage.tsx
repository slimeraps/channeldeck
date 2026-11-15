import {
  AlertTriangle,
  Clapperboard,
  FileVideo,
  Film,
  MoreHorizontal,
  Pencil,
  Scissors,
  Trash2
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { newEdit } from '@shared/editOps'
import type { EditProjectSummary } from '@shared/schemas/editor'
import type { ClipView } from '@shared/schemas/twitch'
import { Editor } from '@renderer/components/editor/Editor'
import { EmptyState } from '@renderer/components/EmptyState'
import { ClipLibraryDialog } from '@renderer/components/post-editor/ClipLibraryDialog'
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
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
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
import { Input } from '@renderer/components/ui/input'
import {
  editClips,
  openProject,
  startProject,
  useDeleteProject,
  useEditProjects,
  useProjectAutosave,
  useRenameProject
} from '@renderer/hooks/useEditProjects'
import { formatClock } from '@renderer/lib/clock'
import { invoke } from '@renderer/lib/ipc'
import { formatRelative } from '@renderer/lib/time'
import { useUiStore } from '@renderer/stores/ui'
import { useVideoEditor } from '@renderer/stores/videoEditor'

const CANVAS_LABEL = { vertical: '9:16', horizontal: '16:9', square: '1:1' } as const

/**
 * The Editor page: your saved edits (projects), newest first, and the editor itself once one
 * is open. Projects save themselves as you work; closing the editor brings back the list.
 */
export function EditorPage(): React.JSX.Element {
  const spec = useVideoEditor((s) => s.spec)
  const origin = useVideoEditor((s) => s.origin)
  const projects = useEditProjects()
  const rename = useRenameProject()
  const remove = useDeleteProject()
  const flush = useProjectAutosave()
  const [pickingClip, setPickingClip] = useState(false)
  const [renaming, setRenaming] = useState<EditProjectSummary | null>(null)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<EditProjectSummary | null>(null)

  async function openVideo(): Promise<void> {
    try {
      const picked = await invoke('media:pickVideo')
      if (!picked) return
      const source = await invoke('editor:source', { path: picked.path })
      const canvas = source.height > source.width ? 'vertical' : 'horizontal'
      await startProject(
        newEdit(
          [{ path: picked.path, durationSec: source.durationSec, clipId: source.clipId }],
          canvas
        )
      )
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  function openClip(clip: ClipView): void {
    setPickingClip(false)
    editClips([clip]).catch((e: Error) => toast.error(e.message))
  }

  if (spec && origin?.kind === 'project') {
    return (
      <Editor
        mode="project"
        title={origin.name}
        onClose={() => {
          void flush().then(() => useVideoEditor.getState().close())
        }}
        onPost={(edit, clipId) => {
          void flush()
          useUiStore.getState().openNewPost(undefined, undefined, clipId ?? undefined, edit)
        }}
      />
    )
  }

  const list = projects.data ?? []
  const start = (
    <div className="flex gap-2">
      <Button onClick={() => setPickingClip(true)}>
        <Clapperboard aria-hidden /> Open a clip…
      </Button>
      <Button variant="outline" onClick={() => void openVideo()}>
        <FileVideo aria-hidden /> Open a video…
      </Button>
    </div>
  )

  return (
    <>
      {projects.isSuccess && list.length === 0 ? (
        <EmptyState icon={Scissors} title="Edit a video" action={start}>
          Trim, cut and join clips, add text, switch between your vertical layouts or draw a new
          one, and render the result. Edits save as projects while you work. On the Clips page,
          select a few clips and choose Edit together… to join them.
        </EmptyState>
      ) : (
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold">Editor</h1>
              <p className="text-sm text-muted-foreground">
                Your edits, newest first. They save themselves while you work.
              </p>
            </div>
            {start}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {list.map((p) => (
              <div
                key={p.id}
                className="group overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary"
              >
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => openProject(p.id).catch((e: Error) => toast.error(e.message))}
                >
                  <div className="relative aspect-video bg-muted">
                    {p.thumbnailUrl ? (
                      <img
                        src={`${p.thumbnailUrl}?v=${encodeURIComponent(p.updatedAt)}`}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <Film className="absolute inset-0 m-auto size-6 text-muted-foreground" />
                    )}
                    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1 text-[11px] text-white tabular-nums">
                      {formatClock(p.durationSec)}
                    </span>
                  </div>
                  <div className="space-y-1 p-2.5">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline">{CANVAS_LABEL[p.canvas]}</Badge>
                      <span>
                        {p.pieces} piece{p.pieces === 1 ? '' : 's'}
                      </span>
                      <span>· {formatRelative(p.updatedAt)}</span>
                    </div>
                    {p.missingFiles ? (
                      <div className="flex items-center gap-1 text-xs text-amber-400">
                        <AlertTriangle className="size-3" aria-hidden /> A video it uses is gone
                      </div>
                    ) : null}
                  </div>
                </button>
                <div className="flex justify-end border-t px-1 py-0.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`More for ${p.name}`}
                      >
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          setName(p.name)
                          setRenaming(p)
                        }}
                      >
                        <Pencil aria-hidden /> Rename…
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(p)}>
                        <Trash2 aria-hidden /> Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pickingClip ? (
        <ClipLibraryDialog onPick={openClip} onClose={() => setPickingClip(false)} />
      ) : null}

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <Input
            value={name}
            maxLength={80}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renaming && name.trim()) {
                rename.mutate({ id: renaming.id, name }, { onSuccess: () => setRenaming(null) })
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || rename.isPending}
              onClick={() =>
                renaming &&
                rename.mutate({ id: renaming.id, name }, { onSuccess: () => setRenaming(null) })
              }
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The project goes away. Your clips, videos, rendered files and posts made from it stay
              where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

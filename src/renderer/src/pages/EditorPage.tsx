import { Clapperboard, FileVideo, Scissors } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { newEdit } from '@shared/editOps'
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
import { Button } from '@renderer/components/ui/button'
import { invoke } from '@renderer/lib/ipc'
import { useVideoEditor } from '@renderer/stores/videoEditor'

/**
 * The Editor page: open a video or a banked clip, then cut, join and frame it, and render it.
 * The edit stays open while you visit other pages. Saved projects and the shortcuts from the
 * post editor and the Clips page come in a later update (PLAN.md → Editor, E4).
 */
export function EditorPage(): React.JSX.Element {
  const spec = useVideoEditor((s) => s.spec)
  const changed = useVideoEditor((s) => s.past.length > 0)
  const [pickingClip, setPickingClip] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  async function openPath(path: string): Promise<void> {
    const source = await invoke('editor:source', { path })
    useVideoEditor
      .getState()
      .open(newEdit([{ path, durationSec: source.durationSec, clipId: source.clipId }]))
  }

  async function openVideo(): Promise<void> {
    try {
      const picked = await invoke('media:pickVideo')
      if (picked) await openPath(picked.path)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  function openClip(clip: ClipView): void {
    setPickingClip(false)
    const path = clip.landscapePath ?? clip.portraitPath
    if (!path) {
      toast.error("That clip isn't downloaded yet.")
      return
    }
    openPath(path).catch((e: Error) => toast.error(e.message))
  }

  if (spec) {
    return (
      <>
        <Editor
          onClose={() => (changed ? setConfirmClose(true) : useVideoEditor.getState().close())}
        />
        <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Close this edit?</AlertDialogTitle>
              <AlertDialogDescription>
                Your changes aren't saved anywhere yet. Rendered files stay in your renders folder.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => useVideoEditor.getState().close()}
              >
                Close edit
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  return (
    <>
      <EmptyState
        icon={Scissors}
        title="Edit a video"
        action={
          <div className="flex gap-2">
            <Button onClick={() => setPickingClip(true)}>
              <Clapperboard aria-hidden /> Open a clip…
            </Button>
            <Button variant="outline" onClick={() => void openVideo()}>
              <FileVideo aria-hidden /> Open a video…
            </Button>
          </div>
        }
      >
        Trim, cut and join clips, switch between your vertical layouts or draw a new one, and render
        the result. Everything runs on your Mac.
      </EmptyState>
      {pickingClip ? (
        <ClipLibraryDialog onPick={openClip} onClose={() => setPickingClip(false)} />
      ) : null}
    </>
  )
}

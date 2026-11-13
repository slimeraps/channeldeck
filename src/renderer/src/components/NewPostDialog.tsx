import { FilePlus2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { useUiStore } from '@renderer/stores/ui'

/** Placeholder until the real post editor lands in Phase 3. */
export function NewPostDialog(): React.JSX.Element {
  const open = useUiStore((s) => s.newPostOpen)
  const setOpen = useUiStore((s) => s.setNewPostOpen)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="size-5" aria-hidden />
            New post
          </DialogTitle>
          <DialogDescription>
            The post editor arrives in Phase 3: pick a channel and a video, fill in title,
            description, tags and thumbnail, and choose when it goes public.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

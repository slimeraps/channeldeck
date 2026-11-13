import { Plus } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Kbd } from '@renderer/components/ui/kbd'
import { useUiStore } from '@renderer/stores/ui'
import { cn } from '@renderer/lib/utils'

export function NewPostButton({ className }: { className?: string }): React.JSX.Element {
  const openNewPost = useUiStore((s) => s.openNewPost)
  return (
    <Button className={cn('justify-between', className)} onClick={() => openNewPost()}>
      <span className="flex items-center gap-2">
        <Plus aria-hidden />
        New post
      </span>
      <Kbd className="bg-primary-foreground/10 text-primary-foreground">⌘N</Kbd>
    </Button>
  )
}

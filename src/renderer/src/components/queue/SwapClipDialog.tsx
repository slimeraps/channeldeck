import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Shuffle } from 'lucide-react'
import { toast } from 'sonner'
import type { PostListItem } from '@shared/schemas/post'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { autopostKey } from '@renderer/hooks/useAutopost'
import { postsKey } from '@renderer/hooks/usePosts'
import { invoke } from '@renderer/lib/ipc'
import { formatDuration } from '@renderer/lib/status'

/** Pick another clip for an autopost that isn't uploaded yet. */
export function SwapClipDialog({
  post,
  onClose
}: {
  post: PostListItem
  onClose: () => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const candidates = useQuery({
    queryKey: ['autopost', 'swap', post.id],
    queryFn: () => invoke('autopost:swapCandidates', { id: post.id }),
    retry: false
  })
  const swap = useMutation({
    mutationFn: (clipId: string) => invoke('autopost:swapClip', { id: post.id, clipId }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: postsKey })
      void qc.invalidateQueries({ queryKey: autopostKey })
      toast.success(`Swapped in "${r.title}"`)
      onClose()
    },
    onError: (e) => toast.error(e.message)
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shuffle className="size-4" aria-hidden /> Swap clip
          </DialogTitle>
          <DialogDescription>
            Replaces “{post.title}” in the same slot.{' '}
            {post.ruleName ? `“${post.ruleName}”` : 'The rule'} won’t pick the current clip again.
          </DialogDescription>
        </DialogHeader>
        {candidates.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Finding clips…
          </div>
        ) : candidates.isError ? (
          <p className="p-6 text-sm text-muted-foreground">{candidates.error.message}</p>
        ) : (candidates.data ?? []).length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No other clips match this rule. Loosen its filters or wait for new clips.
          </p>
        ) : (
          <ul className="grid max-h-[60vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {(candidates.data ?? []).map((clip, i) => (
              <li key={clip.id} className="flex gap-2 rounded-lg border p-2">
                {clip.thumbUrl ? (
                  <img
                    src={clip.thumbUrl}
                    alt=""
                    className="aspect-video w-28 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="aspect-video w-28 shrink-0 rounded bg-muted" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="line-clamp-2 text-sm font-medium">{clip.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      clip.gameName,
                      `${clip.viewCount.toLocaleString()} views`,
                      formatDuration(clip.durationSec),
                      new Date(clip.createdAtUtc).toLocaleDateString()
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <div className="mt-auto flex items-center gap-1.5">
                    {i === 0 ? <Badge variant="secondary">Next up</Badge> : null}
                    {clip.needsRender ? <Badge variant="outline">Vertical render</Badge> : null}
                    <Button
                      size="sm"
                      className="ml-auto h-7"
                      disabled={swap.isPending}
                      onClick={() => swap.mutate(clip.id)}
                    >
                      Use this
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

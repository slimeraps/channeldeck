import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { toast } from 'sonner'
import type { PostStatus, PostSource } from '@shared/constants/enums'
import type { PostDetail, PostListItem } from '@shared/schemas/post'
import { accountsKey } from '@renderer/hooks/useAccounts'
import { invoke } from '@renderer/lib/ipc'

export const postsKey = ['posts'] as const

export interface PostFilter {
  accountId?: number
  statuses?: PostStatus[]
  source?: PostSource
}

export function usePosts(filter: PostFilter = {}): UseQueryResult<PostListItem[]> {
  return useQuery({
    queryKey: [...postsKey, 'list', filter],
    queryFn: () => invoke('posts:list', filter)
  })
}

export function usePostDetail(id: string | null): UseQueryResult<PostDetail> {
  return useQuery({
    queryKey: [...postsKey, 'detail', id],
    queryFn: () => invoke('posts:get', { id: id as string }),
    enabled: id !== null,
    staleTime: 0,
    gcTime: 0
  })
}

/** Posts and channel counts both change when a post is saved or canceled. */
function useInvalidate(): () => void {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: postsKey })
    void qc.invalidateQueries({ queryKey: accountsKey })
  }
}

export function useDuplicatePost(): UseMutationResult<
  PostListItem,
  Error,
  string | { id: string; accountId: number }
> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (vars) => invoke('posts:duplicate', typeof vars === 'string' ? { id: vars } : vars),
    onSuccess: (copy, vars) => {
      invalidate()
      toast.success(
        typeof vars === 'string'
          ? 'Duplicated as a draft'
          : `Copied to ${copy.channelTitle} as a draft`
      )
    },
    onError: (e) => toast.error(e.message)
  })
}

export function useCancelPost(): UseMutationResult<PostListItem, Error, string> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => invoke('posts:cancel', { id }),
    onSuccess: (post) => {
      invalidate()
      toast.success(`Unscheduled "${post.title || 'Untitled'}"`)
    },
    onError: (e) => toast.error(e.message)
  })
}

export function useDeleteDraft(): UseMutationResult<{ deleted: boolean }, Error, string> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => invoke('posts:deleteDraft', { id }),
    onSuccess: () => {
      invalidate()
      toast.success('Draft deleted')
    },
    onError: (e) => toast.error(e.message)
  })
}

export function useRevealPost(): UseMutationResult<{ revealed: boolean }, Error, string> {
  return useMutation({
    mutationFn: (id: string) => invoke('posts:reveal', { id }),
    onError: (e) => toast.error(e.message)
  })
}

export function useUploadNow(): UseMutationResult<PostListItem, Error, string> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => invoke('posts:uploadNow', { id }),
    onSuccess: (post) => {
      invalidate()
      toast.success(`Uploading "${post.title}" now`)
    },
    onError: (e) => toast.error(e.message)
  })
}

export function useRetryPost(): UseMutationResult<PostListItem, Error, string> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => invoke('posts:retry', { id }),
    onSuccess: (post) => {
      invalidate()
      toast.success(`Retrying "${post.title}"`)
    },
    onError: (e) => toast.error(e.message)
  })
}

function useAction<TVars>(
  fn: (vars: TVars) => Promise<PostListItem>,
  success: (post: PostListItem) => string
): UseMutationResult<PostListItem, Error, TVars> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: fn,
    onSuccess: (post) => {
      invalidate()
      toast.success(success(post))
    },
    onError: (e) => toast.error(e.message)
  })
}

export function useApprovePost(): UseMutationResult<PostListItem, Error, string> {
  return useAction(
    (id: string) => invoke('posts:approve', { id }),
    (post) => `Approved "${post.title}"`
  )
}

export function useDecide(): UseMutationResult<
  PostListItem,
  Error,
  { id: string; action: 'publish_now' } | { id: string; action: 'reschedule'; publishAtUtc: string }
> {
  return useAction(
    (vars) => invoke('posts:decide', vars),
    (post) =>
      post.visibilityMode === 'public'
        ? `"${post.title}" will upload and go public now`
        : `"${post.title}" has a new publish time`
  )
}

export function useReschedule(): UseMutationResult<
  PostListItem,
  Error,
  { id: string; publishAtUtc: string }
> {
  return useAction(
    (vars) => invoke('posts:reschedule', vars),
    (post) => `"${post.title}" rescheduled${post.youtubeVideoId ? ' on YouTube' : ''}`
  )
}

export function useKeepPrivate(): UseMutationResult<PostListItem, Error, string> {
  return useAction(
    (id) => invoke('posts:keepPrivate', { id }),
    (post) => `"${post.title}" will stay private on YouTube`
  )
}

export function useDeleteFromYouTube(): UseMutationResult<PostListItem, Error, string> {
  return useAction(
    (id) => invoke('posts:deleteFromYouTube', { id }),
    (post) => `"${post.title}" was deleted from YouTube`
  )
}

export function useSyncStatus(): UseMutationResult<
  { checked: number; changed: number; skippedChannels: number },
  Error,
  void
> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: () => invoke('posts:syncStatus'),
    onSuccess: (r) => {
      invalidate()
      toast.success(
        r.checked === 0
          ? 'Nothing on YouTube to check right now'
          : `Checked ${r.checked} video${r.checked === 1 ? '' : 's'}; ${r.changed} changed`
      )
    },
    onError: (e) => toast.error(e.message)
  })
}

export type BulkPostAction =
  'approve' | 'uploadNow' | 'retry' | 'duplicate' | 'cancel' | 'deleteDraft'

const plural = (n: number, word = 'post'): string => `${n} ${word}${n === 1 ? '' : 's'}`

const BULK: Record<
  BulkPostAction,
  { run: (id: string) => Promise<unknown>; done: (n: number) => string; failed: string }
> = {
  approve: {
    run: (id) => invoke('posts:approve', { id }),
    done: (n) => `Approved ${plural(n)}`,
    failed: 'approved'
  },
  uploadNow: {
    run: (id) => invoke('posts:uploadNow', { id }),
    done: (n) => `Uploading ${plural(n)} now`,
    failed: 'started'
  },
  retry: {
    run: (id) => invoke('posts:retry', { id }),
    done: (n) => `Retrying ${plural(n)}`,
    failed: 'retried'
  },
  duplicate: {
    run: (id) => invoke('posts:duplicate', { id }),
    done: (n) => `Duplicated ${plural(n)} as drafts`,
    failed: 'duplicated'
  },
  cancel: {
    run: (id) => invoke('posts:cancel', { id }),
    done: (n) => `Unscheduled ${plural(n)}`,
    failed: 'unscheduled'
  },
  deleteDraft: {
    run: (id) => invoke('posts:deleteDraft', { id }),
    done: (n) => `Deleted ${plural(n, 'draft')}`,
    failed: 'deleted'
  }
}

/**
 * Runs one post action on many posts, one at a time (main checks each post as usual),
 * then shows a single summary toast.
 */
export function useBulkPostAction(): UseMutationResult<
  { ok: number; errors: string[] },
  Error,
  { action: BulkPostAction; ids: string[] }
> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ action, ids }) => {
      const errors: string[] = []
      let ok = 0
      for (const id of ids) {
        try {
          await BULK[action].run(id)
          ok += 1
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e))
        }
      }
      return { ok, errors }
    },
    onSuccess: ({ ok, errors }, { action }) => {
      invalidate()
      if (ok > 0) toast.success(BULK[action].done(ok))
      if (errors.length > 0) {
        toast.error(
          `${plural(errors.length)} couldn’t be ${BULK[action].failed}: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`
        )
      }
    },
    onError: (e) => toast.error(e.message)
  })
}

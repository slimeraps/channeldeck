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

export function useDuplicatePost(): UseMutationResult<PostListItem, Error, string> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => invoke('posts:duplicate', { id }),
    onSuccess: () => {
      invalidate()
      toast.success('Duplicated as a draft')
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

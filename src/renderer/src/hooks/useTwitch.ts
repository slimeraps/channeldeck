import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { toast } from 'sonner'
import type {
  ClipSearchInput,
  ClipView,
  TwitchAccountView,
  TwitchConfig
} from '@shared/schemas/twitch'
import { postsKey } from '@renderer/hooks/usePosts'
import { invoke } from '@renderer/lib/ipc'

export const twitchKey = ['twitch'] as const
export const clipsKey = ['clips'] as const

export function useTwitchConfig(): UseQueryResult<TwitchConfig> {
  return useQuery({ queryKey: [...twitchKey, 'config'], queryFn: () => invoke('twitch:getConfig') })
}

export function useTwitchAccounts(): UseQueryResult<TwitchAccountView[]> {
  return useQuery({ queryKey: [...twitchKey, 'accounts'], queryFn: () => invoke('twitch:list') })
}

function useInvalidateTwitch(): () => void {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: twitchKey })
    void qc.invalidateQueries({ queryKey: clipsKey })
  }
}

export function useSetTwitchConfig(): UseMutationResult<
  TwitchConfig,
  Error,
  { clientId: string; clientSecret?: string | null }
> {
  const invalidate = useInvalidateTwitch()
  return useMutation({
    mutationFn: (input) => invoke('twitch:setConfig', input),
    onSuccess: () => {
      invalidate()
      toast.success('Twitch app saved')
    },
    onError: (e) => toast.error(e.message)
  })
}

export const twitchSignInKey = ['twitchSignIn'] as const

export function useConnectTwitch(): UseMutationResult<
  TwitchAccountView,
  Error,
  { mode: 'broadcaster' | 'editor'; channelLogin?: string; backfillFromUtc: string | null }
> {
  const invalidate = useInvalidateTwitch()
  return useMutation({
    mutationKey: [...twitchSignInKey, 'connect'],
    mutationFn: (input) => invoke('twitch:connect', input),
    onSuccess: (account) => {
      invalidate()
      toast.success(`Connected ${account.displayName}. Backfilling clips…`)
    },
    onError: (e) => toast.error(e.message)
  })
}

export function useReconnectTwitch(): UseMutationResult<TwitchAccountView, Error, number> {
  const invalidate = useInvalidateTwitch()
  return useMutation({
    mutationKey: [...twitchSignInKey, 'reconnect'],
    mutationFn: (id) => invoke('twitch:reconnect', { id }),
    onSuccess: (account) => {
      invalidate()
      toast.success(`${account.displayName} is reconnected`)
    },
    onError: (e) => toast.error(e.message)
  })
}

export function useTwitchAction<TVars, TOut>(
  fn: (vars: TVars) => Promise<TOut>,
  success?: (out: TOut, vars: TVars) => string | null
): UseMutationResult<TOut, Error, TVars> {
  const invalidate = useInvalidateTwitch()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (out, vars) => {
      invalidate()
      void qc.invalidateQueries({ queryKey: postsKey })
      const message = success?.(out, vars)
      if (message) toast.success(message)
    },
    onError: (e) => toast.error(e.message)
  })
}

export function useClipSearch(
  input: ClipSearchInput | null
): UseQueryResult<{ items: ClipView[]; total: number; games: { id: string; name: string }[] }> {
  return useQuery({
    queryKey: [...clipsKey, input],
    queryFn: () => invoke('clips:search', input as ClipSearchInput),
    enabled: input !== null,
    placeholderData: keepPreviousData
  })
}

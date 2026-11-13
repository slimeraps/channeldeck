import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AccountView, GoogleClientStatus } from '@shared/schemas/account'
import { invoke } from '@renderer/lib/ipc'

export const accountsKey = ['accounts'] as const
export const googleClientKey = ['google', 'client'] as const
/** Add channel and Reconnect both open a Google sign-in; only one can run at a time. */
export const signInMutationKey = ['signIn'] as const

export function useAccounts(): UseQueryResult<AccountView[]> {
  return useQuery({ queryKey: accountsKey, queryFn: () => invoke('accounts:list') })
}

export function useGoogleClientStatus(): UseQueryResult<GoogleClientStatus> {
  return useQuery({ queryKey: googleClientKey, queryFn: () => invoke('google:getClientStatus') })
}

export function useImportClientFile(): UseMutationResult<
  Awaited<ReturnType<typeof invoke<'google:importClientFile'>>>,
  Error,
  void
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => invoke('google:importClientFile'),
    onSuccess: (result) => {
      qc.setQueryData(googleClientKey, result.status)
      if (result.imported) toast.success('Google client file imported')
    },
    onError: (error) => toast.error(error.message)
  })
}

export function useAddChannel(): UseMutationResult<{ added: AccountView[] }, Error, void> {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: [...signInMutationKey, 'add'],
    mutationFn: () => invoke('accounts:add'),
    onSuccess: ({ added }) => {
      void qc.invalidateQueries({ queryKey: accountsKey })
      toast.success(`Connected ${added.map((a) => a.channelTitle).join(', ')}`)
    },
    onError: (error) => toast.error(error.message)
  })
}

export function useReconnect(): UseMutationResult<AccountView, Error, number> {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: [...signInMutationKey, 'reconnect'],
    mutationFn: (accountId: number) => invoke('accounts:reconnect', { accountId }),
    onSuccess: (account) => {
      void qc.invalidateQueries({ queryKey: accountsKey })
      toast.success(`${account.channelTitle} is reconnected`)
    },
    onError: (error) => toast.error(error.message)
  })
}

export function useCancelSignIn(): UseMutationResult<{ canceled: boolean }, Error, void> {
  return useMutation({ mutationFn: () => invoke('accounts:cancelSignIn') })
}

export function useUpdateAccount(): UseMutationResult<
  AccountView,
  Error,
  Parameters<typeof invoke<'accounts:update'>>[1]
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input) => invoke('accounts:update', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: accountsKey }),
    onError: (error) => toast.error(error.message)
  })
}

export function useRefreshAccount(): UseMutationResult<AccountView, Error, number> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (accountId: number) => invoke('accounts:refreshInfo', { accountId }),
    onSuccess: (account) => {
      void qc.invalidateQueries({ queryKey: accountsKey })
      toast.success(`${account.channelTitle} is signed in and up to date`)
    },
    onError: (error) => toast.error(error.message)
  })
}

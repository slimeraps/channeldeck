import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { InvokeOutput } from '@shared/ipc/contract'
import { invoke } from '@renderer/lib/ipc'

export const statusKey = ['status'] as const

/** Today's YouTube quota (refreshes every minute and whenever posts change). */
export function useQuota(): UseQueryResult<InvokeOutput<'app:quota'>> {
  return useQuery({
    queryKey: [...statusKey, 'quota'],
    queryFn: () => invoke('app:quota'),
    refetchInterval: 60_000
  })
}

export function useStorage(): UseQueryResult<InvokeOutput<'app:storage'>> {
  return useQuery({
    queryKey: [...statusKey, 'storage'],
    queryFn: () => invoke('app:storage'),
    refetchInterval: 5 * 60_000
  })
}

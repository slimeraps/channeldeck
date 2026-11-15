import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { InvokeOutput } from '@shared/ipc/contract'
import { invoke } from '@renderer/lib/ipc'

export const healthKey = ['health'] as const

/** The Health page's snapshot (refreshes every 15 seconds while the page is open). */
export function useHealth(): UseQueryResult<InvokeOutput<'health:get'>> {
  return useQuery({
    queryKey: healthKey,
    queryFn: () => invoke('health:get'),
    refetchInterval: 15_000
  })
}

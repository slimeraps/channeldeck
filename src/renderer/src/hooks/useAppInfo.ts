import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { AppInfo } from '@shared/ipc/contract'
import { invoke } from '@renderer/lib/ipc'

export function useAppInfo(): UseQueryResult<AppInfo> {
  return useQuery({
    queryKey: ['app', 'info'],
    queryFn: () => invoke('app:getInfo'),
    staleTime: Infinity
  })
}

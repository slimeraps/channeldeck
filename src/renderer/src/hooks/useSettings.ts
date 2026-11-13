import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Settings, SettingsPatch } from '@shared/schemas/settings'
import { invoke } from '@renderer/lib/ipc'

export const settingsKey = ['settings'] as const

export function useSettings(): UseQueryResult<{
  settings: Settings
  uploadsPausedUntil: string | null
}> {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => invoke('settings:get'),
    refetchInterval: 60_000
  })
}

export function useUpdateSettings(): UseMutationResult<Settings, Error, SettingsPatch> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => invoke('settings:update', patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: settingsKey }),
    onError: (e) => toast.error(e.message)
  })
}

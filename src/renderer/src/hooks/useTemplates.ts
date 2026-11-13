import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { toast } from 'sonner'
import type { SeriesView, TemplateView } from '@shared/schemas/templates'
import { invoke } from '@renderer/lib/ipc'

export const templatesKey = ['templates'] as const

export function useTemplates(): UseQueryResult<TemplateView[]> {
  return useQuery({ queryKey: [...templatesKey, 'list'], queryFn: () => invoke('templates:list') })
}

export function useSeries(): UseQueryResult<SeriesView[]> {
  return useQuery({ queryKey: [...templatesKey, 'series'], queryFn: () => invoke('series:list') })
}

/** A mutation that refreshes templates and series, with toasts. */
export function useTemplateAction<TVars, TOut>(
  fn: (vars: TVars) => Promise<TOut>,
  success?: (out: TOut, vars: TVars) => string | null
): UseMutationResult<TOut, Error, TVars> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (out, vars) => {
      void qc.invalidateQueries({ queryKey: templatesKey })
      const message = success?.(out, vars)
      if (message) toast.success(message)
    },
    onError: (e) => toast.error(e.message)
  })
}

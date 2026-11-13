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
  LayoutInput,
  LayoutView,
  RuleInput,
  RulePreview,
  RulePreviewInput,
  RuleView
} from '@shared/schemas/autopost'
import { postsKey } from '@renderer/hooks/usePosts'
import { invoke } from '@renderer/lib/ipc'

export const autopostKey = ['autopost'] as const
export const layoutsKey = ['layouts'] as const

export function useRules(): UseQueryResult<RuleView[]> {
  return useQuery({ queryKey: [...autopostKey, 'rules'], queryFn: () => invoke('autopost:list') })
}

export function useQuotaForecast(): UseQueryResult<
  { day: string; uploads: number; units: number; overUploads: boolean; overUnits: boolean }[]
> {
  return useQuery({
    queryKey: [...autopostKey, 'forecast'],
    queryFn: () => invoke('autopost:forecast')
  })
}

export function useRulePreview(input: RulePreviewInput | null): UseQueryResult<RulePreview> {
  return useQuery({
    queryKey: [...autopostKey, 'preview', input],
    queryFn: () => invoke('autopost:preview', input as RulePreviewInput),
    enabled: input !== null,
    placeholderData: keepPreviousData
  })
}

function useInvalidate(): () => void {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: autopostKey })
    void qc.invalidateQueries({ queryKey: layoutsKey })
    void qc.invalidateQueries({ queryKey: postsKey })
  }
}

/** A mutation that refreshes rules, layouts and posts, with toasts. */
export function useAutopostAction<TVars, TOut>(
  fn: (vars: TVars) => Promise<TOut>,
  success?: (out: TOut, vars: TVars) => string | null
): UseMutationResult<TOut, Error, TVars> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: fn,
    onSuccess: (out, vars) => {
      invalidate()
      const message = success?.(out, vars)
      if (message) toast.success(message)
    },
    onError: (e) => toast.error(e.message)
  })
}

export function useSaveRule(): UseMutationResult<
  RuleView,
  Error,
  { id?: number; input: RuleInput }
> {
  return useAutopostAction(
    (vars: { id?: number; input: RuleInput }) => invoke('autopost:save', vars),
    (rule, vars) => (vars.id ? `Saved "${rule.input.name}"` : `Created "${rule.input.name}"`)
  )
}

export function useLayouts(): UseQueryResult<LayoutView[]> {
  return useQuery({ queryKey: layoutsKey, queryFn: () => invoke('layouts:list') })
}

export function useSaveLayout(): UseMutationResult<
  LayoutView,
  Error,
  { id?: number; input: LayoutInput }
> {
  return useAutopostAction(
    (vars: { id?: number; input: LayoutInput }) => invoke('layouts:save', vars),
    (layout) => `Saved layout "${layout.name}"`
  )
}

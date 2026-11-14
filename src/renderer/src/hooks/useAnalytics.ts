import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AnalyticsRange, AnalyticsTarget } from '@shared/schemas/analytics'
import { invoke } from '@renderer/lib/ipc'

export const analyticsKey = ['analytics'] as const

function reportKey(accountId: AnalyticsTarget | null, days: AnalyticsRange) {
  return [...analyticsKey, accountId, days] as const
}

/** One channel's report, or every channel added up ('all'). Main caches it for an hour. */
export function useAnalytics(accountId: AnalyticsTarget | null, days: AnalyticsRange) {
  return useQuery({
    queryKey: reportKey(accountId, days),
    queryFn: () => invoke('analytics:report', { accountId: accountId as AnalyticsTarget, days }),
    enabled: accountId !== null,
    staleTime: 10 * 60_000,
    retry: false
  })
}

/** Skips main's cache and asks YouTube again. */
export function useRefreshAnalytics() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { accountId: AnalyticsTarget; days: AnalyticsRange }) =>
      invoke('analytics:report', { ...input, refresh: true }),
    onSuccess: (report, input) => qc.setQueryData(reportKey(input.accountId, input.days), report),
    onError: (error) => toast.error(error.message)
  })
}

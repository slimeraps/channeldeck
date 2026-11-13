import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { TooltipProvider } from '@renderer/components/ui/tooltip'

export function Providers({ children }: { children: ReactNode }): React.JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Data comes from our own main process, not the network.
          queries: { retry: false, refetchOnWindowFocus: false }
        }
      })
  )
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </QueryClientProvider>
  )
}

import { HeartPulse } from 'lucide-react'
import { EmptyState } from '@renderer/components/EmptyState'

/** Read-only shell for the Health page (Settings → Advanced). Data arrives in a later phase. */
export function HealthPage(): React.JSX.Element {
  return (
    <EmptyState icon={HeartPulse} title="Health">
      Health dashboard — more coming soon
    </EmptyState>
  )
}

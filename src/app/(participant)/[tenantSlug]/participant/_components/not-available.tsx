import { AlertCircle } from 'lucide-react'
import { AppCard } from '@/components/ui/app-card'

// PB3: a closed event (draft, or a tier without the participant side) keeps
// the runner's record and account but shows nothing of the event until it
// opens again. Shared by PAR-01 and INFO-01, the two screens that close.
export function NotAvailable({ message }: { message: string }) {
  return (
    <AppCard bodyClassName="flex-row items-start gap-3 p-4">
      <AlertCircle className="mt-0.5 size-5 shrink-0 text-ink-soft" aria-hidden="true" />
      <p className="text-[15px] leading-relaxed text-ink">{message}</p>
    </AppCard>
  )
}

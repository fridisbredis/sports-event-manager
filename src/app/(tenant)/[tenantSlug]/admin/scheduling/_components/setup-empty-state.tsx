import { CalendarPlus } from 'lucide-react'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { useTranslation } from '@/lib/i18n/client'

// Shown when the stage has neither confirmed officials nor work areas — the
// grid has nothing to draw on either axis, so this stands in for it.
export function SetupEmptyState() {
  const { t } = useTranslation('admin')
  return (
    <EmptyStateCard
      Icon={CalendarPlus}
      title={t('scheduling.noAssignmentsTitle')}
      description={t('scheduling.noAssignmentsHint')}
    />
  )
}

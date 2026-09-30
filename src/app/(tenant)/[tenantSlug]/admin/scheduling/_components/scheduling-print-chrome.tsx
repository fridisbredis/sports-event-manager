import { formatDayLabel } from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'

// Print rules live next to the print-only header they govern. `.no-print`
// hides the interactive chrome, the scroll container is unclipped so long
// grids paginate instead of being cut at the viewport, and every floating
// popup is suppressed — none of them make sense on paper.
export function SchedulingPrintStyles() {
  return (
    <style>{`
        .print-only { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .scheduling-scroll-container {
            overflow: visible !important;
            max-height: none !important;
          }
          [data-picker-cell], [data-cell-action], [data-ws-picker], [role='dialog'] {
            display: none !important;
          }
          @page { size: landscape; }
        }
      `}</style>
  )
}

export function SchedulingPrintHeader({
  stageName,
  selectedDay,
}: {
  stageName: string | undefined
  selectedDay: string
}) {
  const { t } = useTranslation('admin')
  return (
    <div className="print-only mb-4">
      <h1 className="page-title">{t('scheduling.title')}</h1>
      <p className="text-sm text-gray-600">
        {stageName}
        {selectedDay ? ` — ${formatDayLabel(selectedDay)}` : ''}
      </p>
    </div>
  )
}

import { useTranslation } from '@/lib/i18n/client'

interface Props {
  dateRangeLabel: string | null
  granularity: number
}

/**
 * Scheduling granularity is fixed at 60 minutes in v1 (PO decision, 2026-09-30).
 * It used to be admin-selectable (30/60/90/120) while the event was a draft.
 *
 * The grid phases its slots from the stage start time on the stage's first day
 * but from midnight on every following day, so any granularity that does not
 * return to :00 every hour gives a multi-day stage a different column grid each
 * day — with a cross-midnight overlap, undetected double-bookings and a final
 * column no operating window can staff. 60 min hides that drift entirely.
 *
 * To re-enable the choice, the phasing must be fixed first (anchor slots to the
 * clock and clamp the last slot at midnight); only then put the Select back here
 * and drop the guard in saveEvent.
 */
export function DatesAndGranularitySection({ dateRangeLabel, granularity }: Props) {
  const { t } = useTranslation('admin')

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {t('eventConfig.datesDuration')}
          </label>
          <div className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500 select-none">
            {dateRangeLabel ?? '—'}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {t('eventConfig.schedulingGranularity')}
          </label>
          <div className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500 select-none">
            {granularity} min
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-400 -mt-2">{t('eventConfig.granularityLockedNote')}</p>
    </>
  )
}

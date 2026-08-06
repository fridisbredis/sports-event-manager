import { useTranslation } from '@/lib/i18n/client'
import { STRIPED_UNAVAILABLE_STYLE } from './grid-helpers'

export function SchedulingLegend() {
  const { t } = useTranslation('admin')
  return (
    <div className="no-print mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded font-mono text-gray-700">
          2/3
        </span>
        {t('scheduling.legendCapacity')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-flex items-center justify-center w-4 h-4 border border-gray-400 rounded-sm text-gray-500 text-[10px]">
          ⊗
        </span>
        {t('scheduling.legendDoubleBooked')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-8 h-4 rounded-sm bg-orange-50 border border-orange-200 inline-block" />
        {t('scheduling.legendOverCapacity')}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="w-8 h-4 rounded-sm inline-block border border-gray-200"
          style={STRIPED_UNAVAILABLE_STYLE}
        />
        {t('scheduling.legendOutsideWindow')}
      </span>
    </div>
  )
}

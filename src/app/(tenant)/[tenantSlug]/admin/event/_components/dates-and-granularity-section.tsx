import { SelectItem } from '@heroui/react'
import { Select } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  isPublished: boolean
  dateRangeLabel: string | null
  granularity: number
  onGranularityChange: (minutes: number) => void
}

export function DatesAndGranularitySection({
  isPublished,
  dateRangeLabel,
  granularity,
  onGranularityChange,
}: Props) {
  const { t } = useTranslation('admin')

  if (isPublished) {
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

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {t('eventConfig.datesDuration')}
        </label>
        <div className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500 select-none">
          {dateRangeLabel ?? '—'}
        </div>
      </div>
      <div className="w-48">
        <Select
          label={t('eventConfig.schedulingGranularity')}
          selectedKeys={[granularity.toString()]}
          onSelectionChange={(keys) => onGranularityChange(Number(Array.from(keys)[0]))}
        >
          <SelectItem key="30" textValue={t('eventConfig.granularity30min')}>
            {t('eventConfig.granularity30min')}
          </SelectItem>
          <SelectItem key="60" textValue={t('eventConfig.granularity60min')}>
            {t('eventConfig.granularity60min')}
          </SelectItem>
          <SelectItem key="90" textValue={t('eventConfig.granularity90min')}>
            {t('eventConfig.granularity90min')}
          </SelectItem>
          <SelectItem key="120" textValue={t('eventConfig.granularity120min')}>
            {t('eventConfig.granularity120min')}
          </SelectItem>
        </Select>
      </div>
    </>
  )
}

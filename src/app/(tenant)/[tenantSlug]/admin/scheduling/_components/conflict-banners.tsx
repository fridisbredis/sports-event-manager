import { CircleX, Info } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'
import type {
  computeDoubleBookedDetails,
  computeOverCapacityDetails,
} from '@/lib/scheduling/grid-logic'

type OverCapacityDetail = ReturnType<typeof computeOverCapacityDetails>[number]
type DoubleBookedDetail = ReturnType<typeof computeDoubleBookedDetails>[number]

function ConflictBanner({
  tone,
  icon,
  heading,
  children,
}: {
  tone: 'warning' | 'danger'
  icon: React.ReactNode
  heading: string
  children: React.ReactNode
}) {
  const styles =
    tone === 'warning'
      ? { box: 'bg-orange-50 border-orange-200 text-orange-700', list: 'text-orange-600' }
      : { box: 'bg-red-50 border-red-200 text-red-700', list: 'text-red-600' }

  return (
    <div className={`no-print mb-3 rounded-md border px-4 py-3 text-sm ${styles.box}`}>
      <div className="flex items-center gap-2">
        {icon}
        {heading}
      </div>
      <ul className={`mt-1.5 ml-6 space-y-0.5 text-xs ${styles.list}`}>{children}</ul>
    </div>
  )
}

export function ConflictBanners({
  overCapacityCount,
  overCapacityDetails,
  doubleBookedCount,
  doubleBookedDetails,
}: {
  overCapacityCount: number
  overCapacityDetails: OverCapacityDetail[]
  doubleBookedCount: number
  doubleBookedDetails: DoubleBookedDetail[]
}) {
  const { t } = useTranslation('admin')
  return (
    <>
      {overCapacityCount > 0 && (
        <ConflictBanner
          tone="warning"
          icon={<Info className="w-4 h-4 text-orange-500 shrink-0" />}
          heading={t('scheduling.overCapacity', { count: overCapacityCount })}
        >
          {overCapacityDetails.map((d, i) => (
            <li key={i}>
              {d.workAreaName} — {d.time} ({d.count}/{d.ceiling}): {d.officialNames.join(', ')}
            </li>
          ))}
        </ConflictBanner>
      )}
      {doubleBookedCount > 0 && (
        <ConflictBanner
          tone="danger"
          icon={<CircleX className="w-4 h-4 text-red-500 shrink-0" />}
          heading={t('scheduling.doubleBooked', { count: doubleBookedCount })}
        >
          {doubleBookedDetails.map((d, i) => (
            <li key={i}>
              {d.officialName} — {d.time} ({d.workAreaNames.join(', ')})
            </li>
          ))}
        </ConflictBanner>
      )}
    </>
  )
}

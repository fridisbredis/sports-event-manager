import { CalendarOff, CircleX, Info } from 'lucide-react'
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

/** One assignment made over a self-reported absence. */
export interface UnavailableDetail {
  officialName: string
  time: string
}

export function ConflictBanners({
  overCapacityCount,
  overCapacityDetails,
  doubleBookedCount,
  doubleBookedDetails,
  unavailableDetails,
}: {
  overCapacityCount: number
  overCapacityDetails: OverCapacityDetail[]
  doubleBookedCount: number
  doubleBookedDetails: DoubleBookedDetail[]
  unavailableDetails: UnavailableDetail[]
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
      {/* Warning, not danger: an official's self-reported absence is softer
          data than a double-booking, which is a physical impossibility. This
          is someone saying they would rather not — the admin decides. */}
      {unavailableDetails.length > 0 && (
        <ConflictBanner
          tone="warning"
          icon={<CalendarOff className="w-4 h-4 text-orange-500 shrink-0" />}
          heading={t('scheduling.unavailableAssigned', { count: unavailableDetails.length })}
        >
          {unavailableDetails.map((d, i) => (
            <li key={i}>
              {d.officialName} — {d.time}
            </li>
          ))}
        </ConflictBanner>
      )}
    </>
  )
}

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
  // Tinted surface, but body text stays near-neutral: a full-colour list on a
  // full-colour box reads as one undifferentiated block.
  const styles =
    tone === 'warning'
      ? {
          box: 'bg-amber-50/70 border-amber-200/80',
          badge: 'bg-amber-100 text-amber-600',
          heading: 'text-amber-900',
        }
      : {
          box: 'bg-red-50/70 border-red-200/80',
          badge: 'bg-red-100 text-red-600',
          heading: 'text-red-900',
        }

  return (
    <div className={`no-print mb-3 rounded-lg border px-4 py-3.5 ${styles.box}`}>
      <div className="flex items-start gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${styles.badge}`}
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className={`text-sm font-medium ${styles.heading}`}>{heading}</p>
          <ul className="mt-2 space-y-1.5 text-sm text-gray-700">{children}</ul>
        </div>
      </div>
    </div>
  )
}

/** One assignment made over a self-reported absence. */
export interface UnavailableDetail {
  officialName: string
  time: string
}

/**
 * Collapse the flat list to one row per official, keeping first-seen order.
 * The caller passes details sorted by start time, so each person's times come
 * out chronological without re-parsing the formatted labels.
 */
function groupByOfficial(details: UnavailableDetail[]) {
  const groups = new Map<string, string[]>()
  for (const d of details) {
    const times = groups.get(d.officialName)
    if (times) times.push(d.time)
    else groups.set(d.officialName, [d.time])
  }
  return [...groups].map(([officialName, times]) => ({ officialName, times }))
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
          icon={<Info className="h-4 w-4" />}
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
          icon={<CircleX className="h-4 w-4" />}
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
          icon={<CalendarOff className="h-4 w-4" />}
          heading={t('scheduling.unavailableAssigned', { count: unavailableDetails.length })}
        >
          {groupByOfficial(unavailableDetails).map((g) => (
            <li key={g.officialName} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-medium text-gray-900">{g.officialName}</span>
              <span className="flex flex-wrap gap-1.5">
                {g.times.map((time, i) => (
                  <span
                    key={i}
                    className="rounded-md border border-amber-200 bg-white px-1.5 py-0.5 text-xs font-medium tabular-nums text-amber-800"
                  >
                    {time}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ConflictBanner>
      )}
    </>
  )
}

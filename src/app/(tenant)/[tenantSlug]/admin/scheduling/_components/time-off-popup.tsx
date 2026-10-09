import { CalendarOff, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/client'
import { useLanguage } from '@/components/i18n-provider'
import { dateLocaleFor } from '@/lib/i18n/date-locale'
import type { UnavailabilityPeriod } from '@/lib/scheduling/unavailability'

export interface TimeOffCell {
  officialName: string
  periods: UnavailabilityPeriod[]
  anchorTop: number
  anchorLeft: number
}

interface TimeOffPopupProps {
  cell: TimeOffCell
  onRemove: (periodId: string) => void
  removingId: string | null
}

/** A stored period as one line, in UTC like every other schedule surface.
 *  The locale follows the reader's language (#251). */
function formatSpan(period: UnavailabilityPeriod, language?: string): string {
  const start = new Date(period.starts_at)
  const end = new Date(period.ends_at)

  const date = new Intl.DateTimeFormat(dateLocaleFor(language), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const time = new Intl.DateTimeFormat(dateLocaleFor(language), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })

  const isMidnight = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0
  if (isMidnight(start) && isMidnight(end)) {
    // Whole-day periods store an exclusive end at the next midnight, so the
    // last day shown is the one before it — printing ends_at would claim an
    // extra day.
    const lastDay = new Date(end.getTime() - 1)
    const first = date.format(start)
    const last = date.format(lastDay)
    return first === last ? first : `${first} – ${last}`
  }

  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)
  return sameDay
    ? `${date.format(start)} ${time.format(start)}–${time.format(end)}`
    : `${date.format(start)} ${time.format(start)} – ${date.format(end)} ${time.format(end)}`
}

/**
 * What covers this cell, and whether this admin may remove it.
 *
 * The ownership rule (Peter, 2026-10-07) is that whoever declared a period
 * owns it. An official's own declaration is therefore shown but not
 * removable — said plainly in the row's own footer rather than by a
 * greyed-out button with no explanation, since "why can't I delete this" is
 * exactly the question an admin would otherwise be left with. The RLS policy
 * refuses it regardless of what this popup offers.
 */
export function TimeOffPopup({ cell, onRemove, removingId }: TimeOffPopupProps) {
  const { t } = useTranslation('admin')
  const language = useLanguage()

  const POPUP_WIDTH = 260
  const opensLeft =
    typeof window !== 'undefined' && cell.anchorLeft + POPUP_WIDTH > window.innerWidth

  return (
    <div
      className="fixed z-50 w-[260px] rounded-md border border-gray-200 bg-white shadow-lg"
      style={{
        top: cell.anchorTop,
        left: cell.anchorLeft,
        transform: opensLeft ? 'translate(-100%, 4px)' : 'translateY(4px)',
      }}
      data-time-off-popup
    >
      <p className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-400">
        <CalendarOff className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{cell.officialName}</span>
      </p>

      <ul className="divide-y divide-gray-100">
        {cell.periods.map((period) => {
          const isAdminSet = period.created_by_role === 'tenant_admin'
          return (
            <li key={period.id} className="px-3 py-2.5">
              <p className="text-sm text-ink">{formatSpan(period, language)}</p>
              <p className="mt-1 text-[11px] text-ink-faint">
                {isAdminSet ? t('scheduling.timeOffSetBy') : t('scheduling.timeOffDeclared')}
              </p>

              {isAdminSet ? (
                <Button
                  color="danger"
                  variant="light"
                  size="sm"
                  className="mt-1 h-7 px-2"
                  isLoading={removingId === period.id}
                  onPress={() => onRemove(period.id)}
                >
                  {t('scheduling.timeOffRemove')}
                </Button>
              ) : (
                <p className="mt-1 flex items-start gap-1.5 text-[11px] text-ink-faint">
                  <Lock className="mt-px size-3 shrink-0" aria-hidden="true" />
                  <span>{t('scheduling.timeOffOnlyOwnerRemoves')}</span>
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

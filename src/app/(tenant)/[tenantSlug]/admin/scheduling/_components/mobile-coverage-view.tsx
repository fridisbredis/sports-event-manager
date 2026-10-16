'use client'

import Link from 'next/link'
import { MapPin, TriangleAlert } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'
import { useLanguage } from '@/components/i18n-provider'
import { formatDayLabel, formatSlotLabel } from '@/lib/scheduling/grid-logic'
import { workAreaColorMap } from '@/lib/theme/work-area-colors'
import { AppCard } from '@/components/ui/app-card'
import { EmptyStateCard } from '@/components/ui/empty-state'
import type { WorkAreaCoverage } from '@/lib/scheduling/coverage'

interface Props {
  tenantSlug: string
  /** The selected stage's allocable days, ascending. */
  days: string[]
  selectedDay: string
  areas: WorkAreaCoverage[]
  /** False when the coverage read failed — see DayCoverage.ok. */
  ok: boolean
}

/**
 * N18: the read-only, phone-shaped counterpart to SCHED-01's editable grid,
 * for an admin checking coverage while standing on site.
 *
 * Deliberately not a grid. SCHED-01 is hours x work areas, which needs width
 * the phone does not have and is driven by pointer-drag gestures that do not
 * survive a touch screen. This borrows MYSCH-01's shape instead — day tabs
 * over a vertical list of cards — because that shape is already proven on a
 * phone in this app, and because the question here is "who is at the finish
 * line this afternoon", which reads better as a list than as a matrix.
 *
 * Shown only below `md`; the desktop grid takes over above it. Both render on
 * the same route, so a link into scheduling works from either device and no
 * second URL has to be kept alive.
 */
export function MobileCoverageView({ tenantSlug, days, selectedDay, areas, ok }: Props) {
  const { t } = useTranslation('admin')
  const language = useLanguage()

  // Same assignment the grid uses, from the same helper, so a work area keeps
  // its colour between the desktop and mobile views.
  const colors = workAreaColorMap(areas.map((a) => ({ id: a.workstationId, color: a.color })))

  return (
    // Labelled region, not a bare div: the desktop grid is still in the DOM at
    // this width (hidden by the breakpoint) and renders the same work-area
    // names, so both a screen reader and a test need a way to address this
    // view rather than whichever copy of a name comes first.
    <section aria-label={t('scheduling.mobileTitle')} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-gray-900">{t('scheduling.mobileTitle')}</h1>
        {/* Says why there is nothing to tap before the admin goes looking for
            an edit affordance that is not there. */}
        <p className="text-sm text-ink-soft">{t('scheduling.mobileSubtitle')}</p>
      </header>

      {/* An empty list and a failed read look identical on a screen built to
          spot unstaffed work areas, so a failure says so rather than letting
          the admin read it as "all clear". */}
      {!ok && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-status-pending-bg px-3 py-2 text-sm text-status-pending-text"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('scheduling.mobileLoadFailed')}
        </p>
      )}

      <DayTabs
        tenantSlug={tenantSlug}
        days={days}
        selectedDay={selectedDay}
        label={t('scheduling.mobileDayLabel')}
        language={language}
      />

      {areas.length === 0 ? (
        <EmptyStateCard Icon={MapPin} title={t('scheduling.mobileNoWorkAreas')} />
      ) : (
        <div className="flex flex-col gap-3">
          {areas.map((area) => {
            const color = colors.get(area.workstationId)
            return (
              <AppCard key={area.workstationId} bodyClassName="p-4">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: color?.bg }}
                  />
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
                    {area.name}
                  </h2>
                  {area.shifts.length > 0 && (
                    <span className="shrink-0 text-xs text-ink-faint">
                      {t('scheduling.mobileShiftCount', { count: area.shifts.length })}
                    </span>
                  )}
                </div>

                {area.shifts.length === 0 ? (
                  // The single most useful thing this view can say. Styled as a
                  // warning rather than as absent content: a work area nobody is
                  // assigned to is what the admin came here to find.
                  <p className="mt-3 flex items-center gap-2 text-sm font-medium text-status-pending-text">
                    <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                    {t('scheduling.mobileUnstaffed')}
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {area.shifts.map((shift) => (
                      <li
                        key={`${shift.officialId}-${shift.start}`}
                        className="flex items-baseline gap-3"
                      >
                        {/* Fixed width so the names line up down the card and
                            the eye can run along the times. */}
                        <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-ink-soft">
                          {formatSlotLabel(new Date(shift.start), language)}–
                          {formatSlotLabel(new Date(shift.end), language)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                          {shift.officialName}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </AppCard>
            )
          })}
        </div>
      )}
    </section>
  )
}

/**
 * Day tabs, as links rather than client state.
 *
 * The day is a server concern here: the page reads one day's assignments, so
 * changing day has to go back to the server anyway. Links also mean a day is
 * shareable and survives a reload — the same reasoning MYSCH-01's selector
 * follows, and the same `?day=` parameter SCHED-01 already honours.
 */
function DayTabs({
  tenantSlug,
  days,
  selectedDay,
  label,
  language,
}: {
  tenantSlug: string
  days: string[]
  selectedDay: string
  label: string
  language: string
}) {
  if (days.length === 0) return null

  // One day needs no chooser, but the screen must still say which day it is
  // showing — the times below carry no date of their own.
  if (days.length === 1) {
    return <p className="section-label">{formatDayLabel(days[0], language)}</p>
  }

  return (
    // Negative margin so the row can bleed to the screen edge while its items
    // keep the page's gutter, which is what makes it read as scrollable.
    <nav aria-label={label} className="-mx-5 overflow-x-auto px-5 scrollbar-none">
      <div className="flex w-max gap-2">
        {days.map((day) => {
          const isSelected = day === selectedDay
          return (
            <Link
              key={day}
              href={`/${tenantSlug}/admin/scheduling?day=${day}`}
              aria-current={isSelected ? 'page' : undefined}
              scroll={false}
              className={`rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                isSelected
                  ? 'bg-tenant-primary font-semibold text-white'
                  : 'bg-status-neutral-bg text-ink-soft'
              }`}
            >
              {formatDayLabel(day, language)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

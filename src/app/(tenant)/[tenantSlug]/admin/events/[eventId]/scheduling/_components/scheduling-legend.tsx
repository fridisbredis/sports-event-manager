import { CalendarOff } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'
import { TIME_OFF_FILL, TIME_OFF_ICON, STRIPED_UNAVAILABLE_STYLE } from './grid-helpers'
import type { SchedulingView } from './scheduling-types'

/**
 * The legend is split in two by what each entry is for.
 *
 * {@link SchedulingCellLegend} names the states you read off the grid
 * constantly — how full a slot is, whether it can take anyone at all — so it
 * sits inside the card, above the time header, where the eye can reach it
 * without leaving the grid.
 *
 * {@link SchedulingWarningLegend} explains the markers you meet only when
 * something is wrong or someone is away. Those are rarer and belong below the
 * grid, out of the way of the work.
 */

const ROW = 'flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-faint'

/**
 * Cell states, shown inside the grid card above the time header.
 *
 * The two views draw different things in a cell, so each gets its own
 * entries. by-work-area shows a slot's fill against its ceiling, and an empty
 * cell is a vacancy you can assign into. by-person shows which work area a
 * person is on, where the same count is secondary detail inside a shift card
 * rather than something you read off an empty cell — and an empty cell means
 * the person is free, not that a place is open. Only the hatching means the
 * same thing in both.
 */
export function SchedulingCellLegend({ view }: { view: SchedulingView }) {
  const { t } = useTranslation('admin')
  const byWorkArea = view === 'by-work-area'
  return (
    <div className={`no-print border-b border-edge-soft px-4 py-2.5 ${ROW}`}>
      {byWorkArea && (
        <span className="flex items-center gap-1.5">
          <span className="rounded border border-edge bg-white px-1.5 py-0.5 font-mono text-ink-soft">
            2/3
          </span>
          {t('scheduling.legendCapacity')}
        </span>
      )}
      {/* A filled cell takes its work area's colour, so the swatch can only
          stand for "some palette colour" — the tenant primary tint is the
          neutral stand-in rather than picking one work area's hue. */}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-6 rounded-sm border border-tenant-primary bg-tenant-primary-tint" />
        {t(byWorkArea ? 'scheduling.legendFilled' : 'scheduling.legendShift')}
      </span>
      {/* Paired with the hatched swatch: an open cell and a closed window are
          only legible as different if you can see them together. */}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-6 rounded-sm border border-edge bg-white" />
        {t(byWorkArea ? 'scheduling.legendAssignable' : 'scheduling.legendFree')}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-6 rounded-sm border border-edge"
          style={STRIPED_UNAVAILABLE_STYLE}
        />
        {t('scheduling.legendOutsideWindow')}
      </span>
    </div>
  )
}

/** Conflict and absence markers, shown below the grid. */
export function SchedulingWarningLegend() {
  const { t } = useTranslation('admin')
  return (
    <div className={`no-print mt-4 ${ROW}`}>
      <span className="flex items-center gap-1.5">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-destructive text-[11px] text-destructive">
          !
        </span>
        {t('scheduling.legendDoubleBooked')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-orange-400 bg-orange-100 text-[11px] text-orange-600">
          !
        </span>
        {t('scheduling.legendOverCapacity')}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={`inline-flex h-4 w-8 items-center justify-center rounded-sm border ${TIME_OFF_FILL.self}`}
        >
          <CalendarOff className={`size-3 ${TIME_OFF_ICON.self}`} aria-hidden="true" />
        </span>
        {t('scheduling.legendTimeOff')}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={`inline-flex h-4 w-8 items-center justify-center rounded-sm border ${TIME_OFF_FILL.admin}`}
        >
          <CalendarOff className={`size-3 ${TIME_OFF_ICON.admin}`} aria-hidden="true" />
        </span>
        {t('scheduling.legendTimeOffAdmin')}
      </span>
      {/* The badge as it appears on a shift card: a small white disc on the
          card's corner, tinted by who recorded the absence underneath. */}
      <span className="flex items-center gap-1.5">
        <span className="inline-flex size-3.5 items-center justify-center rounded-full border border-amber-200 bg-white">
          <CalendarOff className={`size-2.5 ${TIME_OFF_ICON.self}`} aria-hidden="true" />
        </span>
        {t('scheduling.legendClashTimeOff')}
      </span>
    </div>
  )
}

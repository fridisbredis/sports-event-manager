import { CalendarOff } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'
import { TIME_OFF_FILL, TIME_OFF_ICON, STRIPED_UNAVAILABLE_STYLE } from './grid-helpers'

export function SchedulingLegend() {
  const { t } = useTranslation('admin')
  return (
    <div className="no-print mt-5 flex flex-wrap gap-x-6 gap-y-2.5 text-xs text-ink-label">
      <span className="flex items-center gap-2">
        <span className="rounded border border-edge bg-white px-1.5 py-0.5 font-mono text-ink-soft">
          2/3
        </span>
        {t('scheduling.legendCapacity')}
      </span>
      {/* A filled cell takes its work area's colour, so the swatch can only
          stand for "some palette colour" — the tenant primary tint is the
          neutral stand-in rather than picking one work area's hue. */}
      <span className="flex items-center gap-2">
        <span className="inline-block h-4 w-8 rounded-sm border border-tenant-primary bg-tenant-primary-tint" />
        {t('scheduling.legendFilled')}
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-destructive text-[11px] text-destructive">
          !
        </span>
        {t('scheduling.legendDoubleBooked')}
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-orange-400 bg-orange-100 text-[11px] text-orange-600">
          !
        </span>
        {t('scheduling.legendOverCapacity')}
      </span>
      <span className="flex items-center gap-2">
        <span
          className="inline-block h-4 w-8 rounded-sm border border-edge"
          style={STRIPED_UNAVAILABLE_STYLE}
        />
        {t('scheduling.legendOutsideWindow')}
      </span>
      {/* Sits next to the outside-window swatch on purpose: a closed window
          and an unavailable person are the pair most at risk of being read as
          the same thing, and showing them adjacent is what makes the
          difference legible — hatched for "nothing can go here", filled with
          an icon for "this person is away". */}
      <span className="flex items-center gap-2">
        <span
          className={`inline-flex h-4 w-8 items-center justify-center rounded-sm border ${TIME_OFF_FILL.self}`}
        >
          <CalendarOff className={`size-3 ${TIME_OFF_ICON.self}`} aria-hidden="true" />
        </span>
        {t('scheduling.legendTimeOff')}
      </span>
      <span className="flex items-center gap-2">
        <span
          className={`inline-flex h-4 w-8 items-center justify-center rounded-sm border ${TIME_OFF_FILL.admin}`}
        >
          <CalendarOff className={`size-3 ${TIME_OFF_ICON.admin}`} aria-hidden="true" />
        </span>
        {t('scheduling.legendTimeOffAdmin')}
      </span>
    </div>
  )
}

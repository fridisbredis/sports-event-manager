'use client'

import { useState, useTransition } from 'react'
import { CalendarOff, Plus, Trash2 } from 'lucide-react'
import { Switch } from '@heroui/react'
import { CalendarDate, Time, type DateValue } from '@internationalized/date'
import type { RangeValue } from '@react-types/shared'
import { AppCard } from '@/components/ui/app-card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, DateRangePicker, TimeInput } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { toastError, toastSuccess } from '@/lib/toast'
import { DATE_LOCALE } from '@/lib/i18n/date-locale'
import type { UnavailabilityPeriod } from '@/lib/scheduling/unavailability'
import { declareUnavailability, withdrawUnavailability } from '../actions'

interface Props {
  tenantSlug: string
  periods: UnavailabilityPeriod[]
  /** First and last day of the event, bounding the picker. Null leaves it
   *  unbounded — when no stage carries a date there is nothing to bound by. */
  eventDates: { min: string; max: string } | null
}

/** `YYYY-MM-DD` from a picker value, in its own calendar fields — never via
 * `Date`, which would reinterpret the tz-naive value in the browser's zone. */
function toDateString(value: DateValue): string {
  const y = String(value.year).padStart(4, '0')
  const m = String(value.month).padStart(2, '0')
  const d = String(value.day).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Narrows what a TimeInput hands back to the plain `Time` these fields hold.
 *
 * `onChange` is typed as the full TimeValue union (Time | CalendarDateTime |
 * ZonedDateTime) because the same control backs date-time pickers elsewhere.
 * At `Time` granularity with a `Time` value it only ever yields a Time, but
 * the hour/minute pair is read off any of them identically — so this narrows
 * by reconstructing rather than by casting, and a future shape change cannot
 * smuggle a date through unnoticed.
 */
function asTime(value: { hour: number; minute: number } | null): Time | null {
  return value ? new Time(value.hour, value.minute) : null
}

/** `HH:MM` from a time field, or undefined when it is empty. */
function toTimeString(value: Time | null): string | undefined {
  if (!value) return undefined
  return `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`
}

/**
 * `YYYY-MM-DD` as a picker bound.
 *
 * Always a CalendarDate, because the range picker now runs at `day`
 * granularity — a bound of a different shape than the value makes React Aria
 * compare mismatched types and the limit silently stops applying.
 */
function toBound(day: string): DateValue {
  const [y, m, d] = day.split('-').map(Number)
  return new CalendarDate(y, m, d)
}

/**
 * Renders one stored period as a line of prose.
 *
 * Everything renders in UTC, matching every other schedule surface — a period
 * declared against the 09:00 slot must read as 09:00 here too, not shifted
 * into the phone's local zone.
 *
 * A whole-day period is stored with an exclusive end at the next midnight, so
 * the last day shown is the day BEFORE `ends_at`. Printing `ends_at` directly
 * would claim an extra day on every whole-day absence.
 */
export function formatPeriod(period: UnavailabilityPeriod, allDayLabel: string): string {
  const start = new Date(period.starts_at)
  const end = new Date(period.ends_at)

  const isMidnight = (d: Date) =>
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  const wholeDays = isMidnight(start) && isMidnight(end)

  const dateFmt = new Intl.DateTimeFormat(DATE_LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const timeFmt = new Intl.DateTimeFormat(DATE_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })

  if (wholeDays) {
    const lastDay = new Date(end.getTime() - 1)
    const first = dateFmt.format(start)
    const last = dateFmt.format(lastDay)
    return first === last ? `${first} · ${allDayLabel}` : `${first} – ${last} · ${allDayLabel}`
  }

  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)
  if (sameDay) {
    return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`
  }
  return `${dateFmt.format(start)} ${timeFmt.format(start)} – ${dateFmt.format(end)} ${timeFmt.format(end)}`
}

export function AvailabilityManager({ tenantSlug, periods, eventDates }: Props) {
  const { t } = useTranslation('official')
  const [isPending, startTransition] = useTransition()

  const [formOpen, setFormOpen] = useState(false)
  const [allDay, setAllDay] = useState(true)
  // Dates as one range, times as two separate fields. The dates belong
  // together — the picker enforces end-after-start across them — but the times
  // are split out so the range control can stay at `day` granularity and fit a
  // phone; see the picker below.
  const [range, setRange] = useState<RangeValue<DateValue> | null>(null)
  // Default to a plausible working span rather than empty, so turning off
  // "all day" leaves a usable period instead of two blank fields that silently
  // block Save.
  const [startTime, setStartTime] = useState<Time | null>(new Time(9, 0))
  const [endTime, setEndTime] = useState<Time | null>(new Time(17, 0))
  const [reason, setReason] = useState('')

  // `deletingId` is per-row rather than a single boolean so withdrawing one
  // period does not grey out every other row's button.
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const resetForm = () => {
    setRange(null)
    setStartTime(new Time(9, 0))
    setEndTime(new Time(17, 0))
    setReason('')
    setAllDay(true)
  }

  // Times are only required when they are on screen. Clearing a time field
  // while "all day" is off would otherwise send a half-specified period, which
  // the action rejects as ambiguous.
  const canSubmit = range !== null && (allDay || (startTime !== null && endTime !== null))

  const handleSubmit = () => {
    if (!canSubmit || !range) return

    startTransition(async () => {
      const result = await declareUnavailability({
        tenantSlug,
        startDate: toDateString(range.start),
        endDate: toDateString(range.end),
        // Date-only values carry no time, which is exactly what the action
        // reads as "the whole day" — so this needs no separate all-day flag.
        startTime: allDay ? undefined : toTimeString(startTime),
        endTime: allDay ? undefined : toTimeString(endTime),
        reason: reason.trim() || undefined,
      })

      if (result.error) {
        // Action errors come back either as a translated string (the shared
        // guard messages) or as a key into this namespace — the same two
        // shapes the checklist row already handles.
        toastError(result.error.startsWith('availability.') ? t(result.error) : result.error)
        return
      }

      toastSuccess(t('availability.saved'))
      resetForm()
      setFormOpen(false)
    })
  }

  const handleWithdraw = (periodId: string) => {
    setDeletingId(periodId)
    startTransition(async () => {
      const result = await withdrawUnavailability({ tenantSlug, periodId })
      setDeletingId(null)

      if (result.error) {
        toastError(result.error.startsWith('availability.') ? t(result.error) : result.error)
        return
      }
      toastSuccess(t('availability.withdrawn'))
    })
  }

  return (
    <div className="space-y-4">
      <AppCard bodyClassName="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{t('availability.title')}</h2>
            <p className="mt-1 text-sm text-ink-soft">{t('availability.description')}</p>
          </div>
        </div>

        {/* The honest framing, and the reason this screen is safe to use: a
            declaration is advisory. Saying so here prevents the worse failure
            of an official assuming they are unschedulable and not showing up. */}
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-ink-soft">
          {t('availability.advisoryNote')}
        </p>
      </AppCard>

      {periods.length === 0 && !formOpen ? (
        <AppCard bodyClassName="p-5">
          <EmptyState
            Icon={CalendarOff}
            title={t('availability.emptyTitle')}
            description={t('availability.emptyDescription')}
          />
        </AppCard>
      ) : (
        periods.length > 0 && (
          <AppCard bodyClassName="p-0">
            <ul className="divide-y divide-edge-soft">
              {periods.map((period) => (
                <li key={period.id} className="flex items-center gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {formatPeriod(period, t('availability.allDay'))}
                    </p>
                    {period.reason && (
                      <p className="mt-0.5 truncate text-xs text-ink-soft">{period.reason}</p>
                    )}
                  </div>
                  <Button
                    isIconOnly
                    variant="light"
                    size="sm"
                    aria-label={t('availability.withdrawLabel')}
                    isDisabled={isPending}
                    isLoading={deletingId === period.id}
                    onPress={() => handleWithdraw(period.id)}
                  >
                    <Trash2 className="size-4 text-ink-faint" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </AppCard>
        )
      )}

      {formOpen ? (
        <AppCard bodyClassName="p-5">
          <div className="space-y-4">
            {/* Dates only — the times live in their own fields below.
                The stage editor runs this control at `minute` granularity, but
                that is a desktop admin screen: at 414px (iPhone XR, the
                narrowest phone this app targets) two `åååå-mm-dd --:--` groups
                plus a separator overflow the card, and the trailing segments
                are clipped off the right edge. Splitting the times out keeps
                every segment reachable on a phone. */}
            <DateRangePicker
              label={t('availability.periodLabel')}
              granularity="day"
              value={range}
              onChange={setRange}
              // Dates outside the event are greyed out rather than merely
              // rejected on submit: declaring time off for a week the event
              // does not run is silently useless, and a disabled date says so
              // before the official has typed anything. Absent when the event
              // has no dated stages — an unbounded picker beats one that
              // refuses every date.
              minValue={eventDates ? toBound(eventDates.min) : undefined}
              maxValue={eventDates ? toBound(eventDates.max) : undefined}
              // Deliberately NOT isRequired: HeroUI renders a required-but-
              // empty field as invalid on first paint, so the form opened
              // already red with "fill this in" before the official had
              // touched anything. The Save button is disabled until a range is
              // picked, which carries the same requirement without accusing
              // someone of an error they have not made yet. Matches the stage
              // editor's DateRangePicker, which omits it for the same reason.
            />
            {eventDates && (
              <p className="-mt-2 text-xs text-ink-faint">
                {t('availability.eventDatesHint', {
                  from: eventDates.min,
                  to: eventDates.max,
                })}
              </p>
            )}

            {/* Below the dates, because it decides whether the time fields
                that follow appear at all. */}
            <Switch isSelected={allDay} onValueChange={setAllDay} size="sm">
              <span className="text-sm text-ink">{t('availability.allDayLabel')}</span>
            </Switch>

            {!allDay && (
              <div className="flex gap-3">
                <TimeInput
                  label={t('availability.startTimeLabel')}
                  hourCycle={24}
                  value={startTime}
                  onChange={(v) => setStartTime(asTime(v))}
                  className="flex-1"
                />
                <TimeInput
                  label={t('availability.endTimeLabel')}
                  hourCycle={24}
                  value={endTime}
                  onChange={(v) => setEndTime(asTime(v))}
                  className="flex-1"
                />
              </div>
            )}

            <Input
              label={t('availability.reasonLabel')}
              placeholder={t('availability.reasonPlaceholder')}
              value={reason}
              onValueChange={setReason}
              maxLength={200}
            />

            <div className="flex gap-2 pt-1">
              <Button
                color="primary"
                className="flex-1"
                isDisabled={!canSubmit || isPending}
                isLoading={isPending && deletingId === null}
                onPress={handleSubmit}
              >
                {t('availability.save')}
              </Button>
              <Button
                variant="bordered"
                isDisabled={isPending}
                onPress={() => {
                  resetForm()
                  setFormOpen(false)
                }}
              >
                {t('availability.cancel')}
              </Button>
            </div>
          </div>
        </AppCard>
      ) : (
        <Button
          variant="bordered"
          className="w-full"
          startContent={<Plus className="size-4" aria-hidden="true" />}
          onPress={() => setFormOpen(true)}
        >
          {t('availability.addButton')}
        </Button>
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { CalendarOff, Lock, Plus, Trash2 } from 'lucide-react'
import { Switch } from '@heroui/react'
import { CalendarDate, Time, type DateValue } from '@internationalized/date'
import type { RangeValue } from '@react-types/shared'
import { AppCard } from '@/components/ui/app-card'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, TimeInput } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { useLanguage } from '@/components/i18n-provider'
import { toastError, toastSuccess } from '@/lib/toast'
import { dateLocaleFor } from '@/lib/i18n/date-locale'
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

/** Shared date/time formatters. UTC like every other schedule surface — a
 *  period declared against the 09:00 slot must read as 09:00 here too, not
 *  shifted into the phone's local zone.
 *
 *  Built per call rather than once at module load: the locale now follows the
 *  reader's language (#251), which a module-level constant cannot see. */
function dateFmt(language?: string) {
  return new Intl.DateTimeFormat(dateLocaleFor(language), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}
function timeFmt(language?: string) {
  return new Intl.DateTimeFormat(dateLocaleFor(language), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

/** True when a stored period runs midnight to midnight — i.e. whole days. */
function isWholeDays(period: UnavailabilityPeriod): boolean {
  const atMidnight = (iso: string) => {
    const d = new Date(iso)
    return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  }
  return atMidnight(period.starts_at) && atMidnight(period.ends_at)
}

/**
 * The date line of a period card: "Oct 6" or "Oct 11 – Oct 12".
 *
 * A whole-day period is stored with an exclusive end at the next midnight, so
 * the last day shown is the day BEFORE `ends_at`. Printing `ends_at` directly
 * would claim an extra day on every whole-day absence.
 */
export function formatPeriodDates(period: UnavailabilityPeriod, language?: string): string {
  const start = new Date(period.starts_at)
  const end = new Date(period.ends_at)
  const lastDay = isWholeDays(period) ? new Date(end.getTime() - 1) : end

  const fmt = dateFmt(language)
  const first = fmt.format(start)
  const last = fmt.format(lastDay)
  return first === last ? first : `${first} – ${last}`
}

/** The second line: "All day", or the clock times the period actually covers. */
export function formatPeriodTime(
  period: UnavailabilityPeriod,
  allDayLabel: string,
  language?: string
): string {
  if (isWholeDays(period)) return allDayLabel
  const fmt = timeFmt(language)
  return `${fmt.format(new Date(period.starts_at))}–${fmt.format(new Date(period.ends_at))}`
}

export function AvailabilityManager({ tenantSlug, periods, eventDates }: Props) {
  const { t } = useTranslation('official')
  const language = useLanguage()
  const [isPending, startTransition] = useTransition()

  const [formOpen, setFormOpen] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  // Same trapdoor the schedule's disclosure had, one level in — and worse
  // here, because the Add button does not stay put above the form, it is
  // REPLACED by it. The element holding focus is unmounted, so focus falls to
  // <body>: the user loses their place with nothing announced, and a keyboard
  // user's next Tab restarts from the top of the document.
  //
  // The card takes focus rather than the date picker inside it, so a screen
  // reader reads what this region is before its first control, and the picker
  // does not pop its calendar open unbidden.
  useEffect(() => {
    if (!formOpen) return
    const form = formRef.current
    if (!form) return
    form.focus({ preventScroll: true })
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [formOpen])
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

  // `deletingId` is per-row rather than a single boolean so withdrawing one
  // period does not grey out every other row's button.
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const resetForm = () => {
    setRange(null)
    setStartTime(new Time(9, 0))
    setEndTime(new Time(17, 0))
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

        {/* What a declaration actually does, which changed on 2026-10-07:
            Peter asked for a hard block, so the scheduling action now refuses
            to write an assignment onto a declared period. This note said the
            opposite — "a heads-up, not a block" — and leaving it would have
            had officials ringing organisers about a conflict the system
            already prevents.

            It still names the one case that survives: an assignment made
            BEFORE the declaration is never cleared (Frida, same day), because
            that clash is the thing the two of them need to discuss. The shift
            carries its own warning on the schedule, and this says so rather
            than implying the declaration silently won. */}
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-ink-soft">
          {t('availability.blockingNote')}
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
          <div>
            <p className="section-label mb-2">{t('availability.sectionLabel')}</p>
            {/* Separate cards per period rather than one card with dividers:
                each is its own object the official can act on, and the gap
                between them is what makes the delete button read as belonging
                to one row rather than to the list. */}
            <ul className="flex flex-col gap-2">
              {periods.map((period) => {
                // Ownership (Peter, 2026-10-07): an official withdraws only
                // what they declared themselves. The RLS policy already
                // refuses the rest — the point of checking here is that the
                // screen must not offer an action the server will refuse.
                const isOwn = period.created_by_role !== 'tenant_admin'

                return (
                  <li
                    key={period.id}
                    className={`flex items-center gap-3 px-4 py-3 ${CARD_SURFACE}`}
                  >
                    {/* Amber for a self-declared period, slate for one the
                        organisers recorded — the same two colours the admin
                        grid hatches them with, so the same fact wears the same
                        colour on both surfaces. */}
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                        isOwn ? 'bg-orange-50' : 'bg-slate-100'
                      }`}
                    >
                      <CalendarOff
                        className={`size-4 ${isOwn ? 'text-orange-500' : 'text-slate-500'}`}
                        aria-hidden="true"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">
                        {formatPeriodDates(period, language)}
                      </p>
                      {/* Always the period's time now. It used to be the
                          reason when one was given, which meant the row that
                          explained itself was the one that stopped saying
                          when it applied. */}
                      <p className="mt-0.5 truncate text-xs text-ink-soft">
                        {formatPeriodTime(period, t('availability.allDay'), language)}
                      </p>
                    </div>
                    {/* The bin and the lock share this trailing column: both
                        answer "can I withdraw this one?", so putting them in
                        one place lets a reader scan a single column down the
                        list instead of hunting the answer inside each row's
                        text. */}
                    {isOwn ? (
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
                    ) : (
                      // No disabled bin in its place: a greyed-out button still
                      // reads as "this might work", where the lock says plainly
                      // why there is nothing to press.
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                        <Lock className="size-3 shrink-0" aria-hidden="true" />
                        {t('availability.setByOrganisers')}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      )}

      {formOpen ? (
        <AppCard bodyClassName="p-5">
          <div
            ref={formRef}
            // -1: focusable programmatically, never its own Tab stop, so
            // tabbing through the form stays the fields and the two buttons.
            tabIndex={-1}
            role="region"
            aria-label={t('availability.addButton')}
            className="space-y-4 scroll-mt-4 outline-none"
          >
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

'use client'

import Link from 'next/link'
import { CalendarCheck, CalendarOff, CalendarX, ChevronDown, TriangleAlert } from 'lucide-react'
import { AppCard } from '@/components/ui/app-card'
import { EmptyState } from '@/components/ui/empty-state'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  dayKey,
  mergeContiguousSlots,
  groupIntoWorkAreaRuns,
  type WorkAreaRun,
} from '@/lib/scheduling/day-window'
import {
  clashingAuthor,
  mergeAdjacentPeriods,
  type UnavailabilityAuthor,
  type UnavailabilityPeriod,
} from '@/lib/scheduling/unavailability'
import { workAreaColorMap, WORK_AREA_COLORS } from '@/lib/theme/work-area-colors'
import { ChecklistItemRow, type ChecklistCheck, type ChecklistStrings } from './checklist-item-row'
import { AvailabilityManager } from '../../availability/_components/availability-manager'
import { dateLocaleFor } from '@/lib/i18n/date-locale'
import { useLanguage } from '@/components/i18n-provider'

type Todo = { id: string; instruction_text: string; position: number; item_type: string }

/**
 * Current check state for one shift, keyed by `${todoId}|${timeslotStart}`.
 * Built once on the server and looked up per row, so rendering a station with
 * many items over many slots stays a map lookup rather than a scan.
 */
export type CheckMap = Map<string, ChecklistCheck>
type WorkstationRef = {
  id: string
  name: string
  /** Palette name chosen by an admin; null falls back to hashing the id. */
  color: string | null
  description: string | null
  workstation_todos: Todo[]
} | null
export type AssignmentRow = {
  id: string
  timeslot_start: string
  timeslot_end: string
  status: string
  workstations: WorkstationRef
}

type View = 'time' | 'work-area'

interface Strings {
  title: string
  /** Who decides this schedule — not a claim that the page is read-only:
   *  the checklist items on it are written by officials. */
  scheduleOwner: string
  byTime: string
  byWorkstation: string
  noAssignments: string
  noAssignmentsDescription: string
  noAssignmentsOnDay: string
  noAssignmentsOnDayDescription: string
  dayTabsLabel: string
  todoLabel: string
  infoLabel: string
  manageAvailability: string
  timeOffOnDay: string
  timeOffSetByOrganisers: string
  timeOffAllDay: string
  withYouOnShift: string
  timeOffClash: string
  timeOffClashAdmin: string
}
// Order matters: it is both the visual order of the two halves and the order
// the arrow keys step through. `label` keys into Strings so the labels stay
// translated rather than hard-coded here.
const VIEW_OPTIONS = [
  { value: 'time', label: 'byTime' },
  { value: 'work-area', label: 'byWorkstation' },
] as const satisfies ReadonlyArray<{ value: View; label: keyof Strings }>

interface Props {
  assignments: AssignmentRow[]
  /** UTC `YYYY-MM-DD` days this official has shifts on, ascending. */
  days: string[]
  /** The day `assignments` covers. Null only when `days` is empty. */
  selectedDay: string | null
  tenantSlug: string
  strings: Strings
  /** Current check state for the selected day, keyed `${todoId}|${slotStart}`. */
  checks: CheckMap
  /** The viewer, to tell their own tick from a colleague's. */
  currentUserId: string | null
  checklistStrings: ChecklistStrings
  /** The viewer's own declared time off overlapping the selected day. */
  timeOff: UnavailabilityPeriod[]
  /** Colleague names per `workstationId|timeslotStartISO`, excluding the viewer. */
  shiftPeers: Map<string, string[]>
  /** Every period this official declared — the panel manages the whole list,
   *  where `timeOff` above is only what overlaps the day on screen. */
  allTimeOff: UnavailabilityPeriod[]
  /** Event bounds for the panel's date picker. Null leaves it unbounded. */
  eventDates: { min: string; max: string } | null
}

function formatTime(ts: string, language?: string): string {
  return new Date(ts).toLocaleTimeString(dateLocaleFor(language), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function formatDayHeader(ts: string, language?: string): string {
  return new Date(ts).toLocaleDateString(dateLocaleFor(language), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

// Short form for the day tabs — the long header would not fit several tabs
// across a phone. Takes a `YYYY-MM-DD` day rather than a full timestamp, so it
// is anchored to midnight UTC to match the `timeZone: 'UTC'` the rest of this
// component formats in.
function formatDayTab(day: string, language?: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString(dateLocaleFor(language), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function groupByDay(assignments: AssignmentRow[], language?: string) {
  const groups: { key: string; label: string; rows: AssignmentRow[] }[] = []
  for (const a of assignments) {
    const key = dayKey(a.timeslot_start)
    const last = groups[groups.length - 1]
    if (last?.key === key) {
      last.rows.push(a)
    } else {
      groups.push({ key, label: formatDayHeader(a.timeslot_start, language), rows: [a] })
    }
  }
  return groups
}

// Day changes are links, not local state: the point of the `?day=` param is
// that the server fetches one day of shifts instead of the whole event
// (PERF-06). Holding the day in client state would mean shipping every day to
// the browser again, which is the read this change exists to avoid.
function DaySelector({
  days,
  selectedDay,
  tenantSlug,
  label,
}: {
  days: string[]
  selectedDay: string | null
  tenantSlug: string
  label: string
}) {
  // Above the early returns below — hooks cannot be called conditionally.
  const language = useLanguage()

  // Zero days renders the empty state instead, so there is nothing to label.
  if (days.length === 0) return null

  // A single day needs no chooser, but it still needs to say which day is on
  // screen. Returning null here used to drop the only date on the work-area
  // tab, which formats times without dates on purpose and relied on this row
  // to carry the day — an official working one day saw three bare time spans
  // and no date anywhere. A static label rather than a lone tab: one clickable
  // chip that only ever leads back to the page it is on reads as a control
  // that does nothing.
  if (days.length === 1) {
    return (
      <p className="section-label mb-6">{formatDayHeader(`${days[0]}T00:00:00.000Z`, language)}</p>
    )
  }

  return (
    <nav aria-label={label} className="-mx-5 px-5 pb-1 mb-6 overflow-x-auto scrollbar-none">
      <div className="flex gap-2 w-max">
        {days.map((day) => {
          const isSelected = day === selectedDay
          return (
            <Link
              key={day}
              href={`/${tenantSlug}/schedule?day=${day}`}
              aria-current={isSelected ? 'page' : undefined}
              scroll={false}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {formatDayTab(day, language)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

/**
 * The viewer's own declared time off for the day on screen.
 *
 * Shown on the schedule rather than only on the availability page, because
 * this is the screen an official actually opens — having to navigate elsewhere
 * to recall what you told the organisers is how a declaration gets forgotten
 * and someone turns up anyway.
 *
 * Amber and dashed, matching the admin grid's hatch for the same thing, and
 * it must not read like a shift.
 *
 * The strip deliberately does NOT claim the shifts below are cancelled. A
 * declaration blocks NEW assignments, but one made before it was declared is
 * never cleared, so the two can legitimately coexist and the official needs to
 * see both — the shift carries its own clash warning.
 */
/**
 * Amber for what the official declared, slate for what the organisers did.
 *
 * The same pairing the admin grid fills with (`TIME_OFF_FILL`), deliberately:
 * a colour that means
 * "the organisers recorded this" on one screen cannot mean something else on
 * the other, or the two sides stop describing the same event.
 *
 * Both keep the dashed edge and the calendar icon, because they are the same
 * kind of thing — a person blocked — differing only in who said so. That is a
 * hue, not a shape. Reading the label was the only way to tell them apart
 * before, which is no help at a glance down a day.
 */
interface TimeOffPalette {
  card: string
  icon: string
  label: string
  body: string
  gutter: string
  badge: string
  chip: string
}

const TIME_OFF_PALETTE: Record<UnavailabilityAuthor, TimeOffPalette> = {
  official: {
    card: 'border-orange-400 bg-orange-50',
    icon: 'text-orange-600',
    label: 'text-orange-700',
    body: 'text-orange-900',
    gutter: 'text-orange-700',
    badge: 'bg-orange-100',
    chip: 'border-orange-300 bg-orange-50 text-orange-800',
  },
  tenant_admin: {
    card: 'border-slate-400 bg-slate-50',
    icon: 'text-slate-600',
    label: 'text-slate-700',
    body: 'text-slate-900',
    gutter: 'text-slate-700',
    badge: 'bg-slate-100',
    chip: 'border-slate-300 bg-slate-50 text-slate-800',
  },
}

/** The palette for a period, by who recorded it. */
function paletteFor(period: UnavailabilityPeriod): TimeOffPalette {
  return TIME_OFF_PALETTE[period.created_by_role === 'tenant_admin' ? 'tenant_admin' : 'official']
}

function TimeOffStrip({
  timeOff,
  day,
  strings,
}: {
  timeOff: UnavailabilityPeriod[]
  day: string
  strings: Strings
}) {
  if (timeOff.length === 0) return null

  // Three separate drags across one row store three rows, which is right —
  // each is its own statement — but reading them as three absences is wrong
  // when the person is simply away 07:00–10:00.
  const spans = mergeAdjacentPeriods(timeOff)

  // Clipped to the day on screen: a Friday-to-Sunday absence renders on
  // Saturday as "all day", not as its own distant start and end times, which
  // would read as though the person were away only at those moments.
  const dayStart = new Date(`${day}T00:00:00.000Z`).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000

  return (
    <div className="mb-6 flex flex-col gap-2">
      {spans.map((period) => {
        const from = Math.max(new Date(period.starts_at).getTime(), dayStart)
        const to = Math.min(new Date(period.ends_at).getTime(), dayEnd)
        const coversWholeDay = from <= dayStart && to >= dayEnd
        const palette = paletteFor(period)

        return (
          <div
            key={period.id}
            // Deliberately not shaped like a shift card. The cards beside it
            // are white, square-cornered at the left accent, and read
            // time-first; this is a full tinted field with a dashed edge and a
            // small-caps label, so a glance down the day separates "where I am
            // working" from "when I am not" without reading either. The hue
            // then separates who said so.
            className={`flex items-start gap-3 rounded-lg border border-dashed px-3 py-3 ${palette.card}`}
          >
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-md ${palette.badge}`}
            >
              <CalendarOff className={`size-4 ${palette.icon}`} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              {/* Who recorded it, not just that it exists: "the organisers
                  marked you off" and "you told us you were away" are different
                  facts, and an official seeing the first labelled as the second
                  would reasonably think the app invented it. */}
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${palette.label}`}>
                {period.created_by_role === 'tenant_admin'
                  ? strings.timeOffSetByOrganisers
                  : strings.timeOffOnDay}
              </p>
              <p className={`mt-0.5 text-sm font-semibold ${palette.body}`}>
                {coversWholeDay
                  ? strings.timeOffAllDay
                  : `${formatTime(new Date(from).toISOString())}–${formatTime(
                      new Date(to).toISOString()
                    )}`}
              </p>
              {period.reason ? (
                <p className={`mt-0.5 truncate text-xs ${palette.label}`}>{period.reason}</p>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * On a shift card that overlaps declared time off.
 *
 * Amber, like every other time-off surface, but a chip rather than a field:
 * the shift itself still stands — nobody has cancelled it — and painting the
 * whole card amber would say otherwise. It is a flag on a real assignment, so
 * it reads as one.
 *
 * Renders nothing when there is no clash, so callers can hand it the day's
 * periods unconditionally rather than branching at every call site.
 */
function TimeOffClashChip({
  spanStart,
  spanEnd,
  timeOff,
  strings,
  className = '',
}: {
  spanStart: string
  spanEnd: string
  timeOff: UnavailabilityPeriod[]
  strings: Strings
  /** Spacing is the caller's: the timeline stacks the chip under a
   *  description, the work-area list sets it beside a time on one row. */
  className?: string
}) {
  const author = clashingAuthor(spanStart, spanEnd, timeOff)
  if (!author) return null

  // Keyed to the same palette as the absence it refers to, so the chip on a
  // shift and the block it clashes with are visibly the same fact.
  const palette = TIME_OFF_PALETTE[author]

  return (
    <p
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${palette.chip} ${className}`}
    >
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{author === 'tenant_admin' ? strings.timeOffClashAdmin : strings.timeOffClash}</span>
    </p>
  )
}

/** One row of the Time view: a shift run, or a declared absence. */
type TimelineEntry =
  | { kind: 'shift'; startsAt: string; run: WorkAreaRun<AssignmentRow> }
  | { kind: 'timeOff'; startsAt: string; period: UnavailabilityPeriod }

/**
 * Merges shift runs and declared time off into one chronological list.
 *
 * Sorted on start alone, with shifts winning a tie. An absence beginning
 * exactly when a shift does is the rarer case and the shift is the thing the
 * official is being asked to do, so it reads first.
 *
 * Compared as instants rather than strings: periods come back from PostgREST
 * as `+00:00` while assignment timestamps are normalised to `.000Z`, and `+`
 * sorts below `.` — the same hazard `mergeContiguousSlots` documents.
 */
export function buildTimeline(
  runs: WorkAreaRun<AssignmentRow>[],
  timeOff: UnavailabilityPeriod[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...runs.map((run) => ({ kind: 'shift' as const, startsAt: run.span.start, run })),
    ...timeOff.map((period) => ({
      kind: 'timeOff' as const,
      startsAt: period.starts_at,
      period,
    })),
  ]

  return entries.sort((a, b) => {
    const diff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    if (diff !== 0) return diff
    return a.kind === b.kind ? 0 : a.kind === 'shift' ? -1 : 1
  })
}

function TimeView({
  assignments,
  shiftPeers,
  strings,
  timeOff,
  selectedDay,
}: {
  assignments: AssignmentRow[]
  shiftPeers: Map<string, string[]>
  strings: Strings
  timeOff: UnavailabilityPeriod[]
  selectedDay: string | null
}) {
  const language = useLanguage()
  // Still grouped even though the window is usually one day: grouping stays
  // correct if a window ever spans a midnight boundary, which is the one case
  // where these headers still earn their place.
  //
  // A day can carry time off and no shifts at all — booking a day off is
  // precisely when you have none — and groupByDay builds its groups from
  // assignments, so that day would produce no group and render nothing. One
  // empty group for the selected day gives the timeline something to hang the
  // absences on.
  const assignmentGroups = groupByDay(assignments, language)
  const groups =
    assignmentGroups.length > 0 || !selectedDay
      ? assignmentGroups
      : [
          {
            key: selectedDay,
            label: formatDayHeader(`${selectedDay}T00:00:00.000Z`, language),
            rows: [],
          },
        ]

  // Coloured across the whole day, not per day-group, so a work area keeps
  // one colour down the timeline — and the same colour it has on the
  // work-area tab, since both map over the same day's stations.
  const colors = workAreaColorMap(
    assignments
      .map((a) => a.workstations)
      .filter((ws): ws is NonNullable<WorkstationRef> => ws != null)
      .map((ws) => ({ id: ws.id, color: ws.color }))
  )

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.key}>
          {/* Only when this view holds more than one date. DaySelector above
              always names the selected day now — as a static label for a
              single-day schedule, as the highlighted tab otherwise — so a
              header repeating it stutters the same date twice in the same
              `section-label` style. More than one group means the window
              crossed midnight, and then the row above can only name one of
              the dates, so each group has to label itself. */}
          {groups.length > 1 ? <p className="section-label mb-3">{group.label}</p> : null}
          <div className="flex flex-col gap-3">
            {/* Shifts and time off share one timeline, interleaved by start
                time. They were two stacked blocks before — every absence above
                every shift — which made "when am I free between these two
                shifts" a question of reading two lists and comparing clocks.
                Both are statements about the same hours, so they belong in the
                same column.

                One card per run rather than per slot: a three-hour shift is
                three `assignments` rows, and a card each read as three
                separate jobs. Runs break on a gap and on a change of work
                area, so a station worked morning and afternoon stays two
                entries. */}
            {buildTimeline(
              groupIntoWorkAreaRuns(group.rows, (a) => a.workstations?.id ?? null),
              // Only on the group that owns them. With one group (the usual
              // case) that is this one; across a midnight boundary each
              // absence lands on the day it starts, rather than on both.
              groups.length > 1 ? timeOff.filter((p) => dayKey(p.starts_at) === group.key) : timeOff
            ).map((entry) => {
              if (entry.kind === 'timeOff') {
                const period = entry.period
                const dayStart = selectedDay
                  ? new Date(`${selectedDay}T00:00:00.000Z`).getTime()
                  : new Date(period.starts_at).getTime()
                const dayEnd = dayStart + 24 * 60 * 60 * 1000
                const from = Math.max(new Date(period.starts_at).getTime(), dayStart)
                const to = Math.min(new Date(period.ends_at).getTime(), dayEnd)
                const coversWholeDay = from <= dayStart && to >= dayEnd
                const palette = paletteFor(period)

                return (
                  <div key={period.id} className="flex items-start gap-3">
                    <span
                      className={`w-14 shrink-0 pt-3 text-sm font-medium leading-tight ${palette.gutter}`}
                    >
                      {coversWholeDay ? (
                        strings.timeOffAllDay
                      ) : (
                        <>
                          {formatTime(new Date(from).toISOString())}&ndash;
                          <br />
                          {formatTime(new Date(to).toISOString())}
                        </>
                      )}
                    </span>
                    {/* Tinted and dashed where a shift card is white and
                        solid, so the two read as different kinds of entry at a
                        glance even though they share the timeline — and amber
                        or slate by who recorded it. */}
                    <div
                      className={`min-w-0 flex-1 rounded-lg border border-dashed px-4 py-3 ${palette.card}`}
                    >
                      <p
                        className={`flex items-center gap-2 text-sm font-semibold ${palette.body}`}
                      >
                        <CalendarOff
                          className={`size-4 shrink-0 ${palette.icon}`}
                          aria-hidden="true"
                        />
                        {period.created_by_role === 'tenant_admin'
                          ? strings.timeOffSetByOrganisers
                          : strings.timeOffOnDay}
                      </p>
                      {period.reason ? (
                        <p className={`mt-0.5 truncate text-xs ${palette.label}`}>
                          {period.reason}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )
              }

              const run = entry.run
              const ws = run.slots[0].workstations
              const color = (ws && colors.get(ws.id)) ?? WORK_AREA_COLORS[0]
              return (
                <div key={run.span.start} className="flex items-start gap-3">
                  {/* Start and end stacked, not side by side: "08:00-09:00"
                      on one line pushes the card too narrow on a phone. */}
                  <span className="w-14 shrink-0 pt-3 text-sm font-medium leading-tight text-gray-500">
                    {formatTime(run.span.start, language)}&ndash;
                    <br />
                    {formatTime(run.span.end, language)}
                  </span>
                  <AppCard
                    className="card-accent-left-themed min-w-0 flex-1"
                    bodyClassName="px-4 py-3"
                    style={{ '--card-accent': color.fg } as CSSProperties}
                  >
                    <p className="text-sm font-semibold text-gray-900">{ws?.name ?? '—'}</p>
                    {ws?.description ? (
                      <p className="text-xs text-gray-500 mt-0.5">{ws.description}</p>
                    ) : null}
                    {/* The day's whole set, not the entry beside it: an absence
                        is its own timeline row, so a shift can perfectly well
                        run into one listed further down. */}
                    <TimeOffClashChip
                      spanStart={run.span.start}
                      spanEnd={run.span.end}
                      timeOff={timeOff}
                      strings={strings}
                      className="mt-2"
                    />
                    {/* Who else is on this shift. Collected across the run's
                        slots rather than the first one: a three-hour shift is
                        three rows, and a colleague who joins halfway through
                        belongs on the card just as much. */}
                    {(() => {
                      const names = [
                        ...new Set(
                          run.slots.flatMap(
                            (slot) =>
                              shiftPeers.get(
                                `${slot.workstations?.id}|${new Date(
                                  slot.timeslot_start
                                ).toISOString()}`
                              ) ?? []
                          )
                        ),
                      ].sort((a, b) => a.localeCompare(b))

                      if (names.length === 0) return null

                      return (
                        <div className="mt-2 border-t border-edge-soft pt-2">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                            {strings.withYouOnShift}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-soft">{names.join(' · ')}</p>
                        </div>
                      )
                    })()}
                  </AppCard>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function WorkAreaView({
  assignments,
  todoLabel,
  infoLabel,
  checks,
  tenantSlug,
  currentUserId,
  checklistStrings,
  timeOff,
  strings,
}: {
  assignments: AssignmentRow[]
  todoLabel: string
  infoLabel: string
  checks: CheckMap
  tenantSlug: string
  currentUserId: string | null
  checklistStrings: ChecklistStrings
  timeOff: UnavailabilityPeriod[]
  strings: Strings
}) {
  const language = useLanguage()

  // Group by workstation id, preserving first-seen order. Keyed by a Map
  // rather than re-scanning `groups` per row, so an official with many slots
  // at one station doesn't make this quadratic.
  const groups: { ws: NonNullable<WorkstationRef>; rows: AssignmentRow[] }[] = []
  const byId = new Map<string, (typeof groups)[number]>()

  for (const a of assignments) {
    if (!a.workstations) continue
    const ws = a.workstations
    const existing = byId.get(ws.id)
    if (existing) {
      existing.rows.push(a)
    } else {
      const group = { ws, rows: [a] }
      byId.set(ws.id, group)
      groups.push(group)
    }
  }

  // Coloured per work area, not by the tenant theme: on this screen the edge
  // is what tells two cards apart at a glance. `workAreaColorMap` over the
  // whole day's stations rather than `workAreaColor` per card, so two
  // stations on one day can't come out the same colour.
  const colors = workAreaColorMap(groups.map((g) => ({ id: g.ws.id, color: g.ws.color })))

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ ws, rows }) => {
        const sortedTodos = [...ws.workstation_todos].sort((a, b) => a.position - b.position)
        // One computation shared by the time list below and the checklist:
        // both have to agree on what counts as a shift, since the checklist
        // keys its state on these exact boundaries.
        const spans = mergeContiguousSlots(rows)
        // Split, not re-sorted: each group keeps the relative order the admin
        // gave it.
        const checkableTodos = sortedTodos.filter((t) => t.item_type === 'checkbox')
        const infoTodos = sortedTodos.filter((t) => t.item_type !== 'checkbox')
        const color = colors.get(ws.id) ?? WORK_AREA_COLORS[0]
        return (
          <AppCard
            key={ws.id}
            className="card-accent-left-themed"
            bodyClassName="px-4 py-3"
            style={{ '--card-accent': color.fg } as CSSProperties}
          >
            <p className="text-sm font-semibold text-gray-900">{ws.name}</p>
            {ws.description ? (
              <p className="text-xs text-gray-500 mt-0.5">{ws.description}</p>
            ) : null}
            {/* Times only, no dates: the view covers one day, and repeating the
                date on every station is what made this line unreadable for an
                official working the same station across several days.

                One span per line rather than one per slot: a six-hour shift is
                six rows in `assignments`, and listing each start time read as
                seven separate jobs instead of one stretch. Gaps still break
                into separate lines, so a break stays visible. */}
            {/* Per span, not per card: a station worked morning and
                afternoon can clash on one stretch and not the other, and a
                single chip on the card could not say which. */}
            <div className="mt-1 flex flex-col items-start gap-1 text-sm text-gray-500">
              {spans.map((span) => (
                <div key={span.start} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    {formatTime(span.start, language)}&ndash;{formatTime(span.end, language)}
                  </span>
                  <TimeOffClashChip
                    spanStart={span.start}
                    spanEnd={span.end}
                    timeOff={timeOff}
                    strings={strings}
                  />
                </div>
              ))}
            </div>
            {/* Two kinds of row. An 'info' item is still text with a
                decorative bullet — the original v1 treatment, and still the
                default. A 'checkbox' item is a real control that writes
                shared per-shift state (migration 20260930084957), which
                supersedes the earlier "no completion state in v1" decision
                (Peter 2026-06-24, docs/flows/workstation-checklist-config.md:46)
                for items an admin explicitly marks as checkable. */}
            {sortedTodos.length > 0 ? (
              <div className="mt-3 border-t border-gray-100 pt-3">
                {/* Grouped by kind rather than left in admin's single
                    ordering: the two sorts read differently — one is work to
                    perform, the other is context to know — and interleaving
                    them made the actionable rows hard to pick out at a
                    glance. Checkable items come first, since that is what an
                    official opens this screen to do; admin's ordering is
                    preserved within each group. A group with nothing in it
                    renders no heading at all, so a station with only notes
                    looks exactly as it did before. */}
                {checkableTodos.length > 0 ? (
                  <>
                    <p className="section-label mb-2">{todoLabel}</p>
                    <ul className="flex flex-col gap-2">
                      {checkableTodos.map((todo) =>
                        // One row per contiguous run, not per item: a station
                        // worked morning and afternoon gets an independent
                        // tick for each, matching how the state is keyed in
                        // the database.
                        spans.map((span) => (
                          <ChecklistItemRow
                            key={`${todo.id}-${span.start}`}
                            todo={todo}
                            check={checks.get(`${todo.id}|${span.start}`) ?? null}
                            color={color}
                            tenantSlug={tenantSlug}
                            workstationId={ws.id}
                            timeslotStart={span.start}
                            timeslotEnd={span.end}
                            currentUserId={currentUserId}
                            strings={checklistStrings}
                          />
                        ))
                      )}
                    </ul>
                  </>
                ) : null}
                {infoTodos.length > 0 ? (
                  <>
                    <p className={`section-label mb-2 ${checkableTodos.length > 0 ? 'mt-4' : ''}`}>
                      {infoLabel}
                    </p>
                    <ul className="flex flex-col gap-2">
                      {/* An info item says the same thing whenever it is
                          read, so it renders once regardless of how many
                          shifts the station is worked. */}
                      {infoTodos.map((todo) => (
                        <ChecklistItemRow
                          key={todo.id}
                          todo={todo}
                          check={null}
                          color={color}
                          tenantSlug={tenantSlug}
                          workstationId={ws.id}
                          timeslotStart={spans[0]?.start ?? ''}
                          timeslotEnd={spans[0]?.end ?? ''}
                          currentUserId={currentUserId}
                          strings={checklistStrings}
                        />
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </AppCard>
        )
      })}
    </div>
  )
}

export function ScheduleView({
  assignments,
  days,
  selectedDay,
  tenantSlug,
  strings,
  checks,
  currentUserId,
  checklistStrings,
  timeOff,
  shiftPeers,
  allTimeOff,
  eventDates,
}: Props) {
  const [view, setView] = useState<View>('time')
  const [timeOffOpen, setTimeOffOpen] = useState(false)
  const timeOffPanelRef = useRef<HTMLDivElement>(null)

  // Move focus into the panel when it opens, and scroll it into view.
  //
  // Without this the disclosure is a trapdoor: the caret flips, content
  // appears below the fold on a phone, and focus is still sitting on the
  // button — so a keyboard user's next Tab continues past the panel into
  // whatever follows, and a screen reader announces nothing at all. The panel
  // itself takes focus rather than the first field inside it, so the region's
  // heading is read before the controls, and nothing is typed into prematurely.
  //
  // Only on open. Running on close would steal focus back from wherever the
  // user went next, and the collapse already returns them to the button.
  useEffect(() => {
    if (!timeOffOpen) return
    const panel = timeOffPanelRef.current
    if (!panel) return
    panel.focus({ preventScroll: true })
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [timeOffOpen])

  useEffect(() => {
    // Must run after mount, not during a lazy useState initializer: localStorage
    // isn't available during SSR, so reading it there would make the client's
    // hydration render disagree with the server-rendered HTML.
    const saved = localStorage.getItem('official-schedule-view')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === 'time' || saved === 'work-area') setView(saved)
  }, [])

  function handleViewChange(v: View) {
    setView(v)
    localStorage.setItem('official-schedule-view', v)
  }

  // Arrow keys move between the two halves and Home/End jump to an end, which
  // is the keyboard contract a radiogroup promises. Selection follows focus,
  // so moving to an option also switches the view — with only two options and
  // no expensive work behind the switch, that is the expected behaviour.
  function handleToggleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const current = VIEW_OPTIONS.findIndex((o) => o.value === view)
    let next = current

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = current + 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = current - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = VIEW_OPTIONS.length - 1
    else return

    e.preventDefault()
    // Wrap, so the group is a loop rather than two dead ends.
    const wrapped = (next + VIEW_OPTIONS.length) % VIEW_OPTIONS.length
    const target = VIEW_OPTIONS[wrapped]
    handleViewChange(target.value)
    // Focus has to follow the selection, or the next arrow press is read from
    // a button that is no longer the active one.
    e.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [wrapped]?.focus()
  }

  // Two distinct emptinesses. No days at all means nobody has scheduled this
  // official yet. Days but nothing on the selected one means the shift was
  // removed between the day-list read and the windowed read — rare, but it
  // must not render as a blank pane under a highlighted tab.
  const hasNoAssignmentsAtAll = days.length === 0
  // A day carries something if it has shifts OR declared time off. Counting
  // shifts alone showed the "nothing on this day" empty state on a day the
  // official had booked off — hiding the very declaration that put the day in
  // the tab list, which is the day they would most want confirmed.
  const selectedDayIsEmpty =
    !hasNoAssignmentsAtAll && assignments.length === 0 && timeOff.length === 0

  return (
    <div className="px-5 pt-10 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="page-title">{strings.title}</h1>
        <span className="rounded-full border border-edge px-3 py-1 text-sm font-medium text-ink-faint">
          {strings.scheduleOwner}
        </span>
      </div>

      {/* View toggle. A sliding segmented control: one grey track holding a
          single filled thumb that moves between the two halves, rather than
          two bordered buttons that each light up in place. The thumb is an
          absolutely-positioned sibling translated across the track, so the
          movement is one transform rather than two colour swaps — that
          motion is what makes the control read as a slider.

          Semantically it is a radiogroup, not two buttons: the two options
          are one either/or choice, which is what lets a screen reader
          announce "1 of 2" and arrow keys move between them. */}
      <div
        role="radiogroup"
        aria-label={strings.title}
        className="relative mb-6 flex rounded-large bg-surface p-1"
      >
        {/* The moving thumb. aria-hidden because the pressed state is already
            carried by each option's aria-checked. */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-large bg-tenant-primary transition-transform duration-200 ease-out motion-reduce:transition-none ${
            view === 'work-area' ? 'translate-x-full' : 'translate-x-0'
          }`}
        />
        {VIEW_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={view === value}
            // Only the active option is a tab stop; arrow keys move within the
            // group, which is the expected keyboard model for a radiogroup.
            tabIndex={view === value ? 0 : -1}
            onClick={() => handleViewChange(value)}
            onKeyDown={handleToggleKeyDown}
            className={`relative z-10 flex-1 rounded-large py-2 text-sm font-semibold transition-colors ${
              view === value ? 'text-white' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {strings[label]}
          </button>
        ))}
      </div>

      <DaySelector
        days={days}
        selectedDay={selectedDay}
        tenantSlug={tenantSlug}
        label={strings.dayTabsLabel}
      />

      {/* Above the content, and outside every branch below: a day with time
          off and no shifts is the commonest case of all, and rendering this
          inside the schedule branches would hide the declaration on exactly
          the day it matters most. */}
      {/* Work-area view only. The Time view now interleaves these into its
          own timeline, where they belong — rendering the strip there too would
          state every absence twice. The work-area view groups by station
          rather than by clock, so it has no timeline to fold them into and
          keeps the block above. */}
      {selectedDay && view === 'work-area' ? (
        <TimeOffStrip timeOff={timeOff} day={selectedDay} strings={strings} />
      ) : null}

      {/* Content */}
      {hasNoAssignmentsAtAll ? (
        <EmptyState
          Icon={CalendarCheck}
          title={strings.noAssignments}
          description={strings.noAssignmentsDescription}
        />
      ) : selectedDayIsEmpty ? (
        // A different mark from "nothing assigned at all": here there is a
        // schedule, just not on the day in view, and the copy sends them to
        // another day tab.
        <EmptyState
          Icon={CalendarX}
          title={strings.noAssignmentsOnDay}
          description={strings.noAssignmentsOnDayDescription}
        />
      ) : view === 'time' ? (
        <TimeView
          assignments={assignments}
          shiftPeers={shiftPeers}
          strings={strings}
          timeOff={mergeAdjacentPeriods(timeOff)}
          selectedDay={selectedDay}
        />
      ) : (
        <WorkAreaView
          assignments={assignments}
          todoLabel={strings.todoLabel}
          infoLabel={strings.infoLabel}
          checks={checks}
          tenantSlug={tenantSlug}
          currentUserId={currentUserId}
          checklistStrings={checklistStrings}
          timeOff={timeOff}
          strings={strings}
        />
      )}
      {/* Time off expands in place rather than linking away. It belongs to the
          same question this screen answers — when am I working, and when have
          I said I cannot — so sending someone to a separate page meant losing
          sight of the schedule they were just looking at.

          Below the schedule, not above it: the shifts are what someone opens
          this screen for, and a control between the heading and the day tabs
          interrupted the thing they came to read. Declaring time off is the
          follow-up question, so it sits where a follow-up belongs.

          It lives here rather than as a sixth bottom tab: five tabs already
          share a 375px viewport at ~75px each, and a sixth would clip the
          labels. */}
      <button
        type="button"
        onClick={() => setTimeOffOpen((open) => !open)}
        aria-expanded={timeOffOpen}
        aria-controls="time-off-panel"
        // Tinted from the tenant's own primary rather than a fixed blue, the
        // same color-mix the card accents use — a tenant with a green palette
        // gets a green panel, not a stray blue one.
        className="mt-8 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-[filter] hover:brightness-95"
        style={{
          backgroundColor: 'color-mix(in srgb, hsl(var(--tenant-primary)) 8%, white)',
        }}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white">
          <CalendarOff className="size-4 text-tenant-primary" aria-hidden="true" />
        </span>
        <span className="flex-1 truncate text-sm font-semibold text-tenant-primary">
          {strings.manageAvailability}
        </span>
        {/* Down, not right. A right chevron is this app's "go somewhere else"
            affordance — the row would read as a link to another page, which is
            exactly what this stopped being when the panel moved in-place. Down
            says "more below", and flipping to up says "fold it away again". */}
        <ChevronDown
          className={`size-4 shrink-0 text-tenant-primary transition-transform ${
            timeOffOpen ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {timeOffOpen && (
        <div
          id="time-off-panel"
          ref={timeOffPanelRef}
          // -1, not 0: focusable programmatically but never a Tab stop of its
          // own, so the sequence through the panel stays the controls inside it.
          tabIndex={-1}
          role="region"
          aria-label={strings.manageAvailability}
          className="mt-3 scroll-mt-4 outline-none"
        >
          <AvailabilityManager
            tenantSlug={tenantSlug}
            periods={allTimeOff}
            eventDates={eventDates}
          />
        </div>
      )}
    </div>
  )
}

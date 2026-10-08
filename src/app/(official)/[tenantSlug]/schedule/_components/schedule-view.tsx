'use client'

import Link from 'next/link'
import { CalendarCheck, CalendarX } from 'lucide-react'
import { AppCard } from '@/components/ui/app-card'
import { EmptyState } from '@/components/ui/empty-state'
import { useEffect, useState, type CSSProperties } from 'react'
import { dayKey, mergeContiguousSlots, groupIntoWorkAreaRuns } from '@/lib/scheduling/day-window'
import { workAreaColorMap, WORK_AREA_COLORS } from '@/lib/theme/work-area-colors'
import { ChecklistItemRow, type ChecklistCheck, type ChecklistStrings } from './checklist-item-row'
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
  readOnly: string
  byTime: string
  byWorkstation: string
  noAssignments: string
  noAssignmentsDescription: string
  noAssignmentsOnDay: string
  noAssignmentsOnDayDescription: string
  dayTabsLabel: string
  todoLabel: string
  infoLabel: string
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

function TimeView({ assignments }: { assignments: AssignmentRow[] }) {
  const language = useLanguage()
  // Still grouped even though the window is usually one day: grouping stays
  // correct if a window ever spans a midnight boundary, which is the one case
  // where these headers still earn their place.
  const groups = groupByDay(assignments, language)

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
            {/* One card per run rather than per slot: a three-hour shift is
                three `assignments` rows, and a card each read as three
                separate jobs. Runs break on a gap and on a change of work
                area, so a station worked morning and afternoon stays two
                entries. */}
            {groupIntoWorkAreaRuns(group.rows, (a) => a.workstations?.id ?? null).map((run) => {
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
}: {
  assignments: AssignmentRow[]
  todoLabel: string
  infoLabel: string
  checks: CheckMap
  tenantSlug: string
  currentUserId: string | null
  checklistStrings: ChecklistStrings
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
            <div className="text-sm text-gray-500 mt-1">
              {spans.map((span) => (
                <p key={span.start}>
                  {formatTime(span.start, language)}&ndash;{formatTime(span.end, language)}
                </p>
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
}: Props) {
  const [view, setView] = useState<View>('time')

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
  const selectedDayIsEmpty = !hasNoAssignmentsAtAll && assignments.length === 0

  return (
    <div className="px-5 pt-10 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="page-title">{strings.title}</h1>
        <span className="rounded-full border border-edge px-3 py-1 text-sm font-medium text-ink-faint">
          {strings.readOnly}
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
        <TimeView assignments={assignments} />
      ) : (
        <WorkAreaView
          assignments={assignments}
          todoLabel={strings.todoLabel}
          infoLabel={strings.infoLabel}
          checks={checks}
          tenantSlug={tenantSlug}
          currentUserId={currentUserId}
          checklistStrings={checklistStrings}
        />
      )}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AppCard } from '@/components/ui/app-card'
import { useEffect, useState, type CSSProperties } from 'react'
import { dayKey, mergeContiguousSlots } from '@/lib/scheduling/day-window'
import { workAreaColorMap, workAreaDotColor, WORK_AREA_COLORS } from '@/lib/theme/work-area-colors'

type Todo = { id: string; instruction_text: string; position: number }
type WorkstationRef = {
  id: string
  name: string
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
}

interface Props {
  assignments: AssignmentRow[]
  /** UTC `YYYY-MM-DD` days this official has shifts on, ascending. */
  days: string[]
  /** The day `assignments` covers. Null only when `days` is empty. */
  selectedDay: string | null
  tenantSlug: string
  strings: Strings
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function formatDayHeader(ts: string): string {
  return new Date(ts).toLocaleDateString('en-GB', {
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
function formatDayTab(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function groupByDay(assignments: AssignmentRow[]) {
  const groups: { key: string; label: string; rows: AssignmentRow[] }[] = []
  for (const a of assignments) {
    const key = dayKey(a.timeslot_start)
    const last = groups[groups.length - 1]
    if (last?.key === key) {
      last.rows.push(a)
    } else {
      groups.push({ key, label: formatDayHeader(a.timeslot_start), rows: [a] })
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
  // One day needs no chooser, and zero days renders the empty state instead.
  if (days.length < 2) return null

  return (
    <nav aria-label={label} className="-mx-5 px-5 mb-6 overflow-x-auto">
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
              {formatDayTab(day)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

function EmptyIcon() {
  return (
    <div className="w-20 h-20 rounded-large border-2 border-gray-200 bg-gray-100 flex items-center justify-center mb-4">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-10 h-10 text-gray-300"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
      </svg>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
      <EmptyIcon />
      <p className="text-base font-semibold text-gray-900 mb-1">{title}</p>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </div>
  )
}

function TimeView({ assignments }: { assignments: AssignmentRow[] }) {
  // Still grouped even though the window is one day: the header is what
  // confirms which date is on screen, and it stays correct if a window ever
  // spans a boundary.
  const groups = groupByDay(assignments)
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {group.label}
          </p>
          <div className="flex flex-col gap-0">
            {group.rows.map((a) => {
              const ws = a.workstations
              return (
                <div key={a.id} className="flex items-center gap-3 py-3">
                  <span className="w-12 shrink-0 text-sm font-medium text-gray-500 pt-3">
                    {formatTime(a.timeslot_start)}
                  </span>
                  <AppCard className="flex-1 min-w-0" bodyClassName="px-4 py-3">
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
}: {
  assignments: AssignmentRow[]
  todoLabel: string
}) {
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
  const colors = workAreaColorMap(groups.map((g) => g.ws.id))

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ ws, rows }) => {
        const sortedTodos = [...ws.workstation_todos].sort((a, b) => a.position - b.position)
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
              {mergeContiguousSlots(rows).map((span) => (
                <p key={span.start}>
                  {formatTime(span.start)}&ndash;{formatTime(span.end)}
                </p>
              ))}
            </div>
            {/* Text only, deliberately no checkbox. v1 stores no completion state
                (DECISION Peter 2026-06-24, docs/flows/workstation-checklist-config.md:46),
                so a checkbox would be an affordance that ignores every tap. The
                wireframes do show checkboxes — they predate this decision. Add them
                back when completion tracking lands, not before. */}
            {sortedTodos.length > 0 ? (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="section-label mb-2">{todoLabel}</p>
                <ul className="flex flex-col gap-2">
                  {sortedTodos.map((todo) => (
                    <li key={todo.id} className="flex items-start gap-2.5">
                      {/* A filled bullet, deliberately not a checkbox. It
                          marks these as things to do without promising a tap
                          does anything: v1 stores no completion state, so a
                          real checkbox would ignore every tap and leave an
                          official unsure whether their work had registered.
                          Decorative — the text beside it carries the meaning,
                          and <ul>/<li> already tell assistive tech this is a
                          list — so it is hidden rather than announced as an
                          unchecked control. Swap it for a real checkbox when
                          completion tracking lands, not before.

                          Tinted to the card's own work-area colour via
                          `workAreaDotColor`, the same pastel the admin
                          surfaces use for dots and bullets — at full
                          saturation a column of these would read as a row of
                          alerts. */}
                      <span
                        aria-hidden="true"
                        className="mt-[5px] h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: workAreaDotColor(color) }}
                      />
                      <span className="text-sm text-gray-700">{todo.instruction_text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </AppCard>
        )
      })}
    </div>
  )
}

export function ScheduleView({ assignments, days, selectedDay, tenantSlug, strings }: Props) {
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
        <h1 className="text-2xl font-bold text-gray-900">{strings.title}</h1>
        <span className="text-xs font-medium text-gray-400 border border-gray-200 rounded-full px-2.5 py-1">
          {strings.readOnly}
        </span>
      </div>

      {/* View toggle */}
      <div className="flex rounded-large border border-gray-200 overflow-hidden mb-6">
        <Button
          onClick={() => handleViewChange('time')}
          radius="none"
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            view === 'time'
              ? 'bg-primary text-primary-foreground'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {strings.byTime}
        </Button>
        <Button
          onClick={() => handleViewChange('work-area')}
          radius="none"
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            view === 'work-area'
              ? 'bg-primary text-primary-foreground'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {strings.byWorkstation}
        </Button>
      </div>

      <DaySelector
        days={days}
        selectedDay={selectedDay}
        tenantSlug={tenantSlug}
        label={strings.dayTabsLabel}
      />

      {/* Content */}
      {hasNoAssignmentsAtAll ? (
        <EmptyState title={strings.noAssignments} description={strings.noAssignmentsDescription} />
      ) : selectedDayIsEmpty ? (
        <EmptyState
          title={strings.noAssignmentsOnDay}
          description={strings.noAssignmentsOnDayDescription}
        />
      ) : view === 'time' ? (
        <TimeView assignments={assignments} />
      ) : (
        <WorkAreaView assignments={assignments} todoLabel={strings.todoLabel} />
      )}
    </div>
  )
}

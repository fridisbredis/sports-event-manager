import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScheduleView, type AssignmentRow } from './schedule-view'

const STRINGS = {
  title: 'My schedule',
  readOnly: 'Read-only',
  byTime: 'Time',
  byWorkstation: 'Work area',
  noAssignments: 'No assignments',
  noAssignmentsDescription: '',
  noAssignmentsOnDay: 'Nothing on this day',
  noAssignmentsOnDayDescription: '',
  dayTabsLabel: 'Days',
  todoLabel: 'To do',
}

function slot(id: string, start: string, end: string, ws: AssignmentRow['workstations']) {
  return { id, timeslot_start: start, timeslot_end: end, status: 'assigned', workstations: ws }
}

const SOCIAL_MEDIA = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Social Media',
  description: null,
  workstation_todos: [],
}
const WITH_TODOS = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Depån',
  description: 'Cups, jugs and refill point at 5 km',
  workstation_todos: [
    { id: 't2', instruction_text: 'Share finish-line photos', position: 2 },
    { id: 't1', instruction_text: 'Post race-day reminder', position: 1 },
  ],
}

const DEPOT = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Depån',
  description: null,
  workstation_todos: [],
}

function renderWorkAreaView(assignments: AssignmentRow[]) {
  // The view toggle defaults to 'time'; the work-area view is what this file
  // is about, so persist the choice the way the component itself does.
  localStorage.setItem('official-schedule-view', 'work-area')
  return render(
    <ScheduleView
      assignments={assignments}
      days={['2026-08-12']}
      selectedDay="2026-08-12"
      tenantSlug="testklubben"
      strings={STRINGS}
    />
  )
}

describe('ScheduleView work-area view', () => {
  beforeEach(() => localStorage.clear())

  it('shows one merged span instead of one line per slot', async () => {
    renderWorkAreaView([
      slot('a', '2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z', SOCIAL_MEDIA),
      slot('b', '2026-08-12T12:00:00.000Z', '2026-08-12T13:00:00.000Z', SOCIAL_MEDIA),
      slot('c', '2026-08-12T13:00:00.000Z', '2026-08-12T14:00:00.000Z', SOCIAL_MEDIA),
    ])

    expect(await screen.findByText('11:00–14:00')).toBeInTheDocument()
    expect(screen.queryByText('12:00–13:00')).not.toBeInTheDocument()
  })

  it('keeps a break as a separate line within the same card', async () => {
    renderWorkAreaView([
      slot('a', '2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z', SOCIAL_MEDIA),
      slot('b', '2026-08-12T14:00:00.000Z', '2026-08-12T15:00:00.000Z', SOCIAL_MEDIA),
    ])

    expect(await screen.findByText('11:00–12:00')).toBeInTheDocument()
    expect(screen.getByText('14:00–15:00')).toBeInTheDocument()
    expect(screen.getAllByText('Social Media')).toHaveLength(1)
  })

  // The edge colour only renders if the custom property and the class land on
  // the SAME element — `var(--card-accent)` does not resolve from a sibling.
  // A card that silently loses its accent is exactly the regression this
  // guards, since nothing else would fail.
  it('puts the accent variable on the element carrying the accent class', async () => {
    const { container } = renderWorkAreaView([
      slot('a', '2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z', SOCIAL_MEDIA),
    ])

    await screen.findByText('Social Media')
    const accented = container.querySelector('.card-accent-left-themed')
    expect(accented).not.toBeNull()
    expect((accented as HTMLElement).style.getPropertyValue('--card-accent')).not.toBe('')
  })

  it('gives two work areas on one day different accent colours', async () => {
    const { container } = renderWorkAreaView([
      slot('a', '2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z', SOCIAL_MEDIA),
      slot('b', '2026-08-12T12:00:00.000Z', '2026-08-12T13:00:00.000Z', DEPOT),
    ])

    await screen.findByText('Depån')
    const accents = [...container.querySelectorAll('.card-accent-left-themed')].map((el) =>
      (el as HTMLElement).style.getPropertyValue('--card-accent')
    )
    expect(accents).toHaveLength(2)
    expect(new Set(accents).size).toBe(2)
  })

  it('heads the checklist with the to-do label, in position order', async () => {
    renderWorkAreaView([
      slot('a', '2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z', WITH_TODOS),
    ])

    expect(await screen.findByText('To do')).toBeInTheDocument()
    const todos = screen
      .getAllByText(/race-day reminder|finish-line photos/)
      .map((el) => el.textContent)
    expect(todos).toEqual(['Post race-day reminder', 'Share finish-line photos'])
  })

  // An empty heading over nothing reads as a section that failed to load.
  it('omits the label entirely when the work area has no to-dos', async () => {
    renderWorkAreaView([
      slot('a', '2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z', SOCIAL_MEDIA),
    ])

    await screen.findByText('Social Media')
    expect(screen.queryByText('To do')).not.toBeInTheDocument()
  })

  // The ring is decorative. If it ever became a real <input type="checkbox">
  // it would be an affordance that ignores every tap — v1 stores no
  // completion state (DECISION Peter 2026-06-24).
  it('exposes the to-dos as a list, with no checkbox control', async () => {
    renderWorkAreaView([
      slot('a', '2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z', WITH_TODOS),
    ])

    await screen.findByText('To do')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ScheduleView, type AssignmentRow } from './schedule-view'

// The page-level test mocks this component away entirely, so everything below
// the props boundary — the view toggle, its keyboard model, and the localStorage
// round-trip — was previously unexercised. These tests render it for real.

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/components/ui/app-card', () => ({
  AppCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const strings = {
  title: 'My schedule',
  readOnly: 'Read-only',
  byTime: 'Time',
  byWorkstation: 'Work area',
  noAssignments: 'No assignments',
  noAssignmentsDescription: 'none yet',
  noAssignmentsOnDay: 'Nothing today',
  noAssignmentsOnDayDescription: 'nothing on this day',
  dayTabsLabel: 'Days',
}

function assignment(id: string, startHour: number, workstationName: string): AssignmentRow {
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    id,
    timeslot_start: `2026-09-11T${pad(startHour)}:00:00Z`,
    timeslot_end: `2026-09-11T${pad(startHour + 1)}:00:00Z`,
    status: 'assigned',
    workstations: {
      id: `ws-${id}`,
      name: workstationName,
      description: null,
      workstation_todos: [],
    },
  }
}

function renderView(overrides: Partial<Parameters<typeof ScheduleView>[0]> = {}) {
  return render(
    <ScheduleView
      assignments={[assignment('a1', 7, 'Finish line')]}
      days={['2026-09-11']}
      selectedDay="2026-09-11"
      tenantSlug="seed-klubben"
      strings={strings}
      {...overrides}
    />
  )
}

function toggleOptions() {
  return screen.getAllByRole('radio')
}

beforeEach(() => {
  localStorage.clear()
})

describe('ScheduleView view toggle', () => {
  it('exposes the two views as a radiogroup with Time selected by default', () => {
    renderView()

    expect(screen.getByRole('radiogroup')).toBeTruthy()
    const [time, workArea] = toggleOptions()
    expect(time.getAttribute('aria-checked')).toBe('true')
    expect(workArea.getAttribute('aria-checked')).toBe('false')
  })

  it('switches to the work-area view on click and persists the choice', () => {
    renderView()

    fireEvent.click(screen.getByRole('radio', { name: 'Work area' }))

    const [time, workArea] = toggleOptions()
    expect(workArea.getAttribute('aria-checked')).toBe('true')
    expect(time.getAttribute('aria-checked')).toBe('false')
    expect(localStorage.getItem('official-schedule-view')).toBe('work-area')
  })

  it('restores the persisted view on mount', () => {
    localStorage.setItem('official-schedule-view', 'work-area')

    renderView()

    expect(screen.getByRole('radio', { name: 'Work area' }).getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('ignores an unrecognised persisted value rather than rendering a blank view', () => {
    localStorage.setItem('official-schedule-view', 'not-a-view')

    renderView()

    expect(screen.getByRole('radio', { name: 'Time' }).getAttribute('aria-checked')).toBe('true')
  })

  it('keeps only the selected option in the tab order', () => {
    renderView()

    const [time, workArea] = toggleOptions()
    expect(time.getAttribute('tabindex')).toBe('0')
    expect(workArea.getAttribute('tabindex')).toBe('-1')
  })

  it('moves between views with the arrow keys', () => {
    renderView()

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Time' }), { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Work area' }).getAttribute('aria-checked')).toBe(
      'true'
    )

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Work area' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'Time' }).getAttribute('aria-checked')).toBe('true')
  })

  it('wraps around the ends so the group is a loop', () => {
    renderView()

    // Left from the first option lands on the last.
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Time' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'Work area' }).getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('jumps to either end with Home and End', () => {
    renderView()

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Time' }), { key: 'End' })
    expect(screen.getByRole('radio', { name: 'Work area' }).getAttribute('aria-checked')).toBe(
      'true'
    )

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Work area' }), { key: 'Home' })
    expect(screen.getByRole('radio', { name: 'Time' }).getAttribute('aria-checked')).toBe('true')
  })

  it('leaves other keys to the browser', () => {
    renderView()

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Time' }), { key: 'a' })

    expect(screen.getByRole('radio', { name: 'Time' }).getAttribute('aria-checked')).toBe('true')
  })

  it('moves focus with the selection so the next arrow press comes from the active option', () => {
    renderView()

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Time' }), { key: 'ArrowRight' })

    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Work area' }))
  })

  it('renders the toggle even when the selected day has no assignments', () => {
    renderView({ assignments: [] })

    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByText(strings.noAssignmentsOnDay)).toBeTruthy()
  })
})

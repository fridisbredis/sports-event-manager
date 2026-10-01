import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
  infoLabel: 'Good to know',
}

function slot(id: string, start: string, end: string, ws: AssignmentRow['workstations']) {
  return { id, timeslot_start: start, timeslot_end: end, status: 'assigned', workstations: ws }
}

const SOCIAL_MEDIA = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Social Media',
  color: null,
  description: null,
  workstation_todos: [],
}
const WITH_TODOS = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Depån',
  color: null,
  description: 'Cups, jugs and refill point at 5 km',
  workstation_todos: [
    { id: 't2', instruction_text: 'Share finish-line photos', position: 2, item_type: 'info' },
    { id: 't1', instruction_text: 'Post race-day reminder', position: 1, item_type: 'info' },
  ],
}

// Deliberately interleaved in `position` order, so a test that only checked
// admin's ordering would pass while the groups were still mixed.
const MIXED_TODOS = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Finish line',
  color: null,
  description: null,
  workstation_todos: [
    { id: 'm1', instruction_text: 'Radio channel 3', position: 0, item_type: 'info' },
    { id: 'm2', instruction_text: 'Collect timing chips', position: 1, item_type: 'checkbox' },
    { id: 'm3', instruction_text: 'Cups are by the table', position: 2, item_type: 'info' },
    { id: 'm4', instruction_text: 'Hand out medals', position: 3, item_type: 'checkbox' },
  ],
}

const DEPOT = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Depån',
  color: null,
  description: null,
  workstation_todos: [],
}

// The checklist props these tests don't exercise. Kept minimal on purpose:
// the fixtures above are all `info` items, which render exactly as they did
// before checkboxes existed, so these only have to satisfy the types.
const CHECKLIST_STRINGS = {
  toggleLabel: 'Check off',
  checkedBy: 'Checked by {{name}} at {{time}}',
  someone: 'someone',
  confirmTitle: 'Are you sure?',
  confirmBody: '{{name}} checked this off. Uncheck it anyway?',
  confirmCancel: 'No, keep it',
  confirmConfirm: 'Yes, uncheck',
  saveFailed: 'Could not save. Try again.',
}

const CHECKLIST_PROPS = {
  checks: new Map(),
  currentUserId: null,
  checklistStrings: CHECKLIST_STRINGS,
}

function renderView(view: 'time' | 'work-area', assignments: AssignmentRow[]) {
  localStorage.setItem('official-schedule-view', view)
  return render(
    <ScheduleView
      assignments={assignments}
      days={['2026-08-12']}
      selectedDay="2026-08-12"
      tenantSlug="testklubben"
      strings={STRINGS}
      {...CHECKLIST_PROPS}
    />
  )
}

// The view toggle defaults to 'time', so the work-area tests persist the
// choice the way the component itself does.
function renderWorkAreaView(assignments: AssignmentRow[]) {
  return renderView('work-area', assignments)
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

  // WITH_TODOS is all informational, so it heads the 'Good to know' group —
  // the point of the assertion is unchanged: a heading, then admin's own
  // ordering beneath it.
  it('heads the checklist with its group label, in position order', async () => {
    renderWorkAreaView([
      slot('a', '2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z', WITH_TODOS),
    ])

    expect(await screen.findByText('Good to know')).toBeInTheDocument()
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
  // Informational items still carry no checkbox — only an item the admin
  // marked as checkable gets one.
  it('exposes informational to-dos as a list, with no checkbox control', async () => {
    renderWorkAreaView([
      slot('a', '2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z', WITH_TODOS),
    ])

    await screen.findByText('Good to know')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('ScheduleView time view', () => {
  beforeEach(() => localStorage.clear())

  it('shows one card per run, with the run its own time span', async () => {
    renderView('time', [
      slot('a', '2026-08-12T11:00:00.000Z', '2026-08-12T12:00:00.000Z', SOCIAL_MEDIA),
      slot('b', '2026-08-12T12:00:00.000Z', '2026-08-12T13:00:00.000Z', SOCIAL_MEDIA),
      slot('c', '2026-08-12T13:00:00.000Z', '2026-08-12T14:00:00.000Z', SOCIAL_MEDIA),
    ])

    expect(await screen.findAllByText('Social Media')).toHaveLength(1)
    expect(screen.getByText(/11:00/)).toBeInTheDocument()
    expect(screen.getByText(/14:00/)).toBeInTheDocument()
  })

  // Two touching slots at two different work areas must stay two cards —
  // merging on time alone would claim the official was in both places.
  it('keeps back-to-back slots at different work areas as separate cards', async () => {
    renderView('time', [
      slot('a', '2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z', SOCIAL_MEDIA),
      slot('b', '2026-08-12T09:00:00.000Z', '2026-08-12T10:00:00.000Z', DEPOT),
    ])

    expect(await screen.findByText('Social Media')).toBeInTheDocument()
    expect(screen.getByText('Depån')).toBeInTheDocument()
    expect(screen.getAllByText(/08:00|09:00|10:00/).length).toBeGreaterThan(0)
  })

  it('shows the same work area twice when it recurs after a gap', async () => {
    renderView('time', [
      slot('a', '2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z', SOCIAL_MEDIA),
      slot('b', '2026-08-12T15:00:00.000Z', '2026-08-12T16:00:00.000Z', SOCIAL_MEDIA),
    ])

    expect(await screen.findAllByText('Social Media')).toHaveLength(2)
  })

  it('gives a work area the same accent colour in both views', async () => {
    const read = (container: HTMLElement) =>
      [...container.querySelectorAll('.card-accent-left-themed')].map((el) =>
        (el as HTMLElement).style.getPropertyValue('--card-accent')
      )

    const rows = [
      slot('a', '2026-08-12T08:00:00.000Z', '2026-08-12T09:00:00.000Z', SOCIAL_MEDIA),
      slot('b', '2026-08-12T09:00:00.000Z', '2026-08-12T10:00:00.000Z', DEPOT),
    ]

    const timeView = renderView('time', rows)
    await screen.findByText('Depån')
    const timeAccents = read(timeView.container)
    timeView.unmount()

    const workAreaView = renderView('work-area', rows)
    await screen.findByText('Depån')
    expect(read(workAreaView.container)).toEqual(timeAccents)
  })
})

// The page-level test mocks this component away entirely, so the view toggle —
// its click behaviour, keyboard model and localStorage round-trip — had no
// coverage of its own. These render it for real.
describe('ScheduleView view toggle', () => {
  beforeEach(() => localStorage.clear())

  const ONE_SLOT = () => [
    slot('a1', '2026-08-12T07:00:00.000Z', '2026-08-12T08:00:00.000Z', SOCIAL_MEDIA),
  ]

  function renderToggle() {
    return renderView('time', ONE_SLOT())
  }

  // renderView persists a view before mounting, which is exactly what the
  // default and fallback cases must NOT have — so they mount directly.
  function renderUnset({ keepStorage = false } = {}) {
    if (!keepStorage) localStorage.clear()
    return render(
      <ScheduleView
        assignments={ONE_SLOT()}
        days={['2026-08-12']}
        selectedDay="2026-08-12"
        tenantSlug="testklubben"
        strings={STRINGS}
        {...CHECKLIST_PROPS}
      />
    )
  }

  function optionNamed(name: string) {
    return screen.getByRole('radio', { name })
  }

  it('exposes the two views as a radiogroup with Time selected by default', () => {
    renderUnset()

    expect(screen.getByRole('radiogroup')).toBeTruthy()
    expect(optionNamed('Time').getAttribute('aria-checked')).toBe('true')
    expect(optionNamed('Work area').getAttribute('aria-checked')).toBe('false')
  })

  it('switches to the work-area view on click and persists the choice', () => {
    renderToggle()

    fireEvent.click(optionNamed('Work area'))

    expect(optionNamed('Work area').getAttribute('aria-checked')).toBe('true')
    expect(optionNamed('Time').getAttribute('aria-checked')).toBe('false')
    expect(localStorage.getItem('official-schedule-view')).toBe('work-area')
  })

  it('restores the persisted view on mount', () => {
    renderWorkAreaView(ONE_SLOT())

    expect(optionNamed('Work area').getAttribute('aria-checked')).toBe('true')
  })

  it('ignores an unrecognised persisted value rather than rendering a blank view', () => {
    localStorage.setItem('official-schedule-view', 'not-a-view')
    renderUnset({ keepStorage: true })

    expect(optionNamed('Time').getAttribute('aria-checked')).toBe('true')
  })

  it('keeps only the selected option in the tab order', () => {
    renderToggle()

    expect(optionNamed('Time').getAttribute('tabindex')).toBe('0')
    expect(optionNamed('Work area').getAttribute('tabindex')).toBe('-1')
  })

  it('moves between views with the arrow keys', () => {
    renderToggle()

    fireEvent.keyDown(optionNamed('Time'), { key: 'ArrowRight' })
    expect(optionNamed('Work area').getAttribute('aria-checked')).toBe('true')

    fireEvent.keyDown(optionNamed('Work area'), { key: 'ArrowLeft' })
    expect(optionNamed('Time').getAttribute('aria-checked')).toBe('true')
  })

  it('wraps around the ends so the group is a loop', () => {
    renderToggle()

    fireEvent.keyDown(optionNamed('Time'), { key: 'ArrowLeft' })

    expect(optionNamed('Work area').getAttribute('aria-checked')).toBe('true')
  })

  it('jumps to either end with Home and End', () => {
    renderToggle()

    fireEvent.keyDown(optionNamed('Time'), { key: 'End' })
    expect(optionNamed('Work area').getAttribute('aria-checked')).toBe('true')

    fireEvent.keyDown(optionNamed('Work area'), { key: 'Home' })
    expect(optionNamed('Time').getAttribute('aria-checked')).toBe('true')
  })

  it('leaves other keys to the browser', () => {
    renderToggle()

    fireEvent.keyDown(optionNamed('Time'), { key: 'a' })

    expect(optionNamed('Time').getAttribute('aria-checked')).toBe('true')
  })

  it('moves focus with the selection so the next arrow press comes from the active option', () => {
    renderToggle()

    fireEvent.keyDown(optionNamed('Time'), { key: 'ArrowRight' })

    expect(document.activeElement).toBe(optionNamed('Work area'))
  })

  it('renders the toggle even when the selected day has no assignments', () => {
    renderView('time', [])

    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByText(STRINGS.noAssignmentsOnDay)).toBeTruthy()
  })
})

// The day row is the only place the work-area view can learn its date: that
// view formats times without dates on purpose. A single-day schedule used to
// render no day row at all, which left those spans dateless.
describe('ScheduleView day label', () => {
  beforeEach(() => localStorage.clear())

  const ONE_DAY = () => [
    slot('a', '2026-08-12T10:00:00.000Z', '2026-08-12T11:00:00.000Z', SOCIAL_MEDIA),
  ]

  function renderDays(view: 'time' | 'work-area', days: string[], selectedDay: string) {
    localStorage.setItem('official-schedule-view', view)
    return render(
      <ScheduleView
        assignments={ONE_DAY()}
        days={days}
        selectedDay={selectedDay}
        tenantSlug="testklubben"
        strings={STRINGS}
        {...CHECKLIST_PROPS}
      />
    )
  }

  it('names the day on the work-area view when there is only one day', () => {
    renderDays('work-area', ['2026-08-12'], '2026-08-12')

    expect(screen.getByText('onsdag 12 augusti')).toBeTruthy()
  })

  it('renders the single day as a static label, not a link that goes nowhere', () => {
    renderDays('work-area', ['2026-08-12'], '2026-08-12')

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('navigation', { name: STRINGS.dayTabsLabel })).toBeNull()
  })

  it('shows the date once, not twice, on the time view for a single day', () => {
    renderDays('time', ['2026-08-12'], '2026-08-12')

    expect(screen.getAllByText('onsdag 12 augusti')).toHaveLength(1)
  })

  it('still renders clickable day tabs when there is more than one day', () => {
    renderDays('work-area', ['2026-08-12', '2026-08-13'], '2026-08-12')

    expect(screen.getByRole('navigation', { name: STRINGS.dayTabsLabel })).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('leaves the date to the tabs on the time view across several days', () => {
    // The selected tab already reads 'ons 12 aug.'. A per-group header under it
    // spelled the same date out a second time, which is what this asserts is
    // gone — the long form should appear nowhere on screen.
    renderDays('time', ['2026-08-12', '2026-08-13'], '2026-08-12')

    expect(screen.queryByText('onsdag 12 augusti')).toBeNull()
    expect(screen.getByRole('link', { name: 'ons 12 aug.' })).toBeTruthy()
  })

  it('labels each group when one day window crosses midnight', () => {
    // A night shift puts two dates in one view. The tab row can only name the
    // day that was selected, so here the headers are the only thing telling
    // the two groups apart and they stay.
    localStorage.setItem('official-schedule-view', 'time')
    render(
      <ScheduleView
        assignments={[
          slot('a', '2026-08-12T22:00:00.000Z', '2026-08-12T23:00:00.000Z', SOCIAL_MEDIA),
          slot('b', '2026-08-13T00:00:00.000Z', '2026-08-13T01:00:00.000Z', DEPOT),
        ]}
        days={['2026-08-12', '2026-08-13']}
        selectedDay="2026-08-12"
        tenantSlug="testklubben"
        strings={STRINGS}
        {...CHECKLIST_PROPS}
      />
    )

    expect(screen.getByText('onsdag 12 augusti')).toBeTruthy()
    expect(screen.getByText('torsdag 13 augusti')).toBeTruthy()
  })
})

describe('ScheduleView checklist grouping', () => {
  it('puts checkable items above informational ones, under their own headings', () => {
    renderWorkAreaView([slot('a1', '2026-08-12T08:00:00Z', '2026-08-12T09:00:00Z', MIXED_TODOS)])

    const checkables = screen.getAllByRole('checkbox').map((el) => el.getAttribute('aria-label'))
    expect(checkables).toEqual(['Check off: Collect timing chips', 'Check off: Hand out medals'])

    // Both headings present, and the actionable group comes first in the DOM.
    const todoHeading = screen.getByText('To do')
    const infoHeading = screen.getByText('Good to know')
    expect(
      todoHeading.compareDocumentPosition(infoHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('shows no empty heading for a station with only notes', () => {
    renderWorkAreaView([slot('a1', '2026-08-12T08:00:00Z', '2026-08-12T09:00:00Z', WITH_TODOS)])

    expect(screen.queryByText('To do')).not.toBeInTheDocument()
    expect(screen.getByText('Good to know')).toBeInTheDocument()
  })
})

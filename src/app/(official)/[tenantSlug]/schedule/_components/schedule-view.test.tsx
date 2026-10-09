import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import type { UnavailabilityPeriod } from '@/lib/scheduling/unavailability'
import { buildTimeline, ScheduleView, type AssignmentRow } from './schedule-view'
import { I18nProvider } from '@/components/i18n-provider'

const STRINGS = {
  title: 'My schedule',
  scheduleOwner: 'Set by organisers',
  byTime: 'Time',
  byWorkstation: 'Work area',
  noAssignments: 'No assignments',
  noAssignmentsDescription: '',
  noAssignmentsOnDay: 'Nothing on this day',
  noAssignmentsOnDayDescription: '',
  dayTabsLabel: 'Days',
  todoLabel: 'To do',
  infoLabel: 'Good to know',
  manageAvailability: 'Manage time off',
  timeOffOnDay: 'Declared time off',
  timeOffSetByOrganisers: 'Time off set by organisers',
  timeOffAllDay: 'All day',
  withYouOnShift: 'With you on this shift',
  timeOffClash: 'You said you were away at this time',
  timeOffClashAdmin: 'The organisers marked you away at this time',
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
  // No declared time off by default; the cases that care pass their own.
  timeOff: [],
  // No colleagues by default — the shift-peer cases build their own map.
  shiftPeers: new Map<string, string[]>(),
  // The collapsible panel starts closed, so these only have to satisfy types.
  allTimeOff: [],
  eventDates: null,
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

  // Wrapped in the provider, and with the language named explicitly: these
  // labels are the weekday and month names, which now follow the UI language.
  // Rendering bare would assert against whatever the context default happens
  // to be, so the Swedish expectations below would start passing or failing on
  // a change to that default rather than on anything this file is testing.
  function renderDays(
    view: 'time' | 'work-area',
    days: string[],
    selectedDay: string,
    language: 'sv' | 'en' = 'sv'
  ) {
    localStorage.setItem('official-schedule-view', view)
    return render(
      <I18nProvider language={language}>
        <ScheduleView
          assignments={ONE_DAY()}
          days={days}
          selectedDay={selectedDay}
          tenantSlug="testklubben"
          strings={STRINGS}
          {...CHECKLIST_PROPS}
        />
      </I18nProvider>
    )
  }

  it('names the day on the work-area view when there is only one day', () => {
    renderDays('work-area', ['2026-08-12'], '2026-08-12')

    expect(screen.getByText('onsdag 12 augusti')).toBeTruthy()
  })

  // The regional format is pinned and only the names follow the language, so
  // an English reader gets 'Wednesday 12 August' — not en-GB's '12/08/2026'
  // and certainly not en-US's Sunday-first '8/12/2026'.
  it('names the day in English when that is the UI language', () => {
    renderDays('work-area', ['2026-08-12'], '2026-08-12', 'en')

    expect(screen.getByText('Wednesday, 12 August')).toBeTruthy()
  })

  it('renders the single day as a static label, not a link that goes nowhere', () => {
    renderDays('work-area', ['2026-08-12'], '2026-08-12')

    // Scoped to the day nav rather than the whole screen: the header also
    // carries a standing link to the time-off screen, which is not a day tab
    // and must not make this assertion fail.
    expect(screen.queryByRole('navigation', { name: STRINGS.dayTabsLabel })).toBeNull()
    expect(screen.queryByRole('link', { name: /augusti|aug/ })).toBeNull()
  })

  it('shows the date once, not twice, on the time view for a single day', () => {
    renderDays('time', ['2026-08-12'], '2026-08-12')

    expect(screen.getAllByText('onsdag 12 augusti')).toHaveLength(1)
  })

  it('still renders clickable day tabs when there is more than one day', () => {
    renderDays('work-area', ['2026-08-12', '2026-08-13'], '2026-08-12')

    const dayNav = screen.getByRole('navigation', { name: STRINGS.dayTabsLabel })
    expect(dayNav).toBeTruthy()
    // Counted within the day nav, not across the screen — the header's
    // time-off link is a link too, and counting it here would make this test
    // break on an unrelated addition rather than on a day-tab regression.
    expect(within(dayNav).getAllByRole('link')).toHaveLength(2)
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
      <I18nProvider language="sv">
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
      </I18nProvider>
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

describe('ScheduleView declared time off', () => {
  beforeEach(() => localStorage.clear())

  const DAY = '2026-08-12'

  function renderWithTimeOff(
    timeOff: { id: string; starts_at: string; ends_at: string; reason: string | null }[],
    assignments: AssignmentRow[] = [],
    days: string[] = [DAY]
  ) {
    // Work-area view: that is where the strip lives now. The time view folds
    // the same periods into its timeline instead, covered further down.
    localStorage.setItem('official-schedule-view', 'work-area')
    return render(
      <ScheduleView
        assignments={assignments}
        days={days}
        selectedDay={DAY}
        tenantSlug="testklubben"
        strings={STRINGS}
        {...CHECKLIST_PROPS}
        timeOff={timeOff.map((p) => ({ ...p, official_id: 'off-1' }))}
      />
    )
  }

  it('shows the strip on a day with no shifts at all', () => {
    // The commonest case, and the reason the strip renders outside the
    // schedule's branches: declaring a day off usually means there is nothing
    // else on that day, and rendering inside them would hide it exactly then.
    renderWithTimeOff(
      [
        {
          id: 'p1',
          starts_at: `${DAY}T00:00:00.000Z`,
          ends_at: '2026-08-13T00:00:00.000Z',
          reason: null,
        },
      ],
      [],
      []
    )

    expect(screen.getByText(STRINGS.timeOffOnDay, { exact: false })).toBeInTheDocument()
    expect(screen.getByText(STRINGS.timeOffAllDay, { exact: false })).toBeInTheDocument()
  })

  it('renders nothing when no time off is declared', () => {
    renderWithTimeOff([])

    expect(screen.queryByText(STRINGS.timeOffOnDay, { exact: false })).not.toBeInTheDocument()
  })

  it('shows the clipped times for a partial-day period', () => {
    renderWithTimeOff([
      {
        id: 'p1',
        starts_at: `${DAY}T10:00:00.000Z`,
        ends_at: `${DAY}T12:00:00.000Z`,
        reason: null,
      },
    ])

    expect(screen.getByText(/10:00/)).toBeInTheDocument()
    expect(screen.getByText(/12:00/)).toBeInTheDocument()
    // A partial period is not "all day", even though it is time off.
    expect(screen.queryByText(STRINGS.timeOffAllDay, { exact: false })).not.toBeInTheDocument()
  })

  it('reads a multi-day period as all day on a day it spans', () => {
    // Clipped to the day on screen: printing the period's own distant start
    // and end would say "away 09:00–17:00" on a day the person is away the
    // whole time.
    renderWithTimeOff([
      {
        id: 'p1',
        starts_at: '2026-08-11T09:00:00.000Z',
        ends_at: '2026-08-14T17:00:00.000Z',
        reason: null,
      },
    ])

    expect(screen.getByText(STRINGS.timeOffAllDay, { exact: false })).toBeInTheDocument()
  })

  // The reason was removed from every screen, but the column still holds text
  // written before that. Inverted rather than deleted: this now guards that a
  // stored reason stays out of the UI, which a plain deletion would not.
  it('never shows a stored reason', () => {
    renderWithTimeOff([
      {
        id: 'p1',
        starts_at: `${DAY}T00:00:00.000Z`,
        ends_at: '2026-08-13T00:00:00.000Z',
        reason: 'Jobbar',
      },
    ])

    expect(screen.queryByText('Jobbar')).not.toBeInTheDocument()
  })

  it('still shows the shifts underneath — a declaration does not cancel them', () => {
    // An admin may schedule over a declaration, so the two legitimately
    // coexist and the official must see both.
    renderWithTimeOff(
      [
        {
          id: 'p1',
          starts_at: `${DAY}T00:00:00.000Z`,
          ends_at: '2026-08-13T00:00:00.000Z',
          reason: null,
        },
      ],
      [slot('a1', `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, DEPOT)]
    )

    expect(screen.getByText(STRINGS.timeOffOnDay, { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Depån')).toBeInTheDocument()
  })
})

describe('ScheduleView time off authorship', () => {
  beforeEach(() => localStorage.clear())

  it("labels organiser-recorded time off as such, not as the official's own", () => {
    // The two are different facts. An official seeing "you declared this" for
    // something the organisers recorded would reasonably think the app made it
    // up — which is exactly what the first version of this strip did.
    localStorage.setItem('official-schedule-view', 'work-area')
    render(
      <ScheduleView
        assignments={[]}
        days={['2026-08-12']}
        selectedDay="2026-08-12"
        tenantSlug="testklubben"
        strings={STRINGS}
        {...CHECKLIST_PROPS}
        timeOff={[
          {
            id: 'p1',
            official_id: 'off-1',
            starts_at: '2026-08-12T07:00:00.000Z',
            ends_at: '2026-08-12T08:00:00.000Z',
            reason: null,
            created_by_role: 'tenant_admin',
          },
        ]}
      />
    )

    expect(screen.getByText(STRINGS.timeOffSetByOrganisers, { exact: false })).toBeInTheDocument()
    expect(screen.queryByText(STRINGS.timeOffOnDay, { exact: false })).not.toBeInTheDocument()
  })
})

describe('ScheduleView shift peers', () => {
  beforeEach(() => localStorage.clear())

  const DAY = '2026-08-12'

  function renderWithPeers(peers: Map<string, string[]>, assignments: AssignmentRow[]) {
    localStorage.setItem('official-schedule-view', 'time')
    return render(
      <ScheduleView
        assignments={assignments}
        days={[DAY]}
        selectedDay={DAY}
        tenantSlug="testklubben"
        strings={STRINGS}
        {...CHECKLIST_PROPS}
        shiftPeers={peers}
      />
    )
  }

  it('lists the colleagues on the same shift', () => {
    const start = `${DAY}T08:00:00.000Z`
    renderWithPeers(new Map([[`${DEPOT.id}|${start}`, ['Anna Andersson', 'Bosse Bergström']]]), [
      slot('a1', start, `${DAY}T09:00:00.000Z`, DEPOT),
    ])

    expect(screen.getByText(STRINGS.withYouOnShift)).toBeInTheDocument()
    expect(screen.getByText(/Anna Andersson/)).toBeInTheDocument()
    expect(screen.getByText(/Bosse Bergström/)).toBeInTheDocument()
  })

  it('renders nothing when the viewer works the shift alone', () => {
    renderWithPeers(new Map(), [slot('a1', `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, DEPOT)])

    expect(screen.queryByText(STRINGS.withYouOnShift)).not.toBeInTheDocument()
  })

  it('unions peers across a multi-slot run, without repeating a name', () => {
    // A three-hour shift is three assignment rows. A colleague on only part of
    // it still belongs on the card, and one present throughout must be listed
    // once rather than three times.
    const h8 = `${DAY}T08:00:00.000Z`
    const h9 = `${DAY}T09:00:00.000Z`
    const h10 = `${DAY}T10:00:00.000Z`

    renderWithPeers(
      new Map([
        [`${DEPOT.id}|${h8}`, ['Anna Andersson']],
        [`${DEPOT.id}|${h9}`, ['Anna Andersson', 'Bosse Bergström']],
      ]),
      [
        slot('a1', h8, h9, DEPOT),
        slot('a2', h9, h10, DEPOT),
        slot('a3', h10, `${DAY}T11:00:00.000Z`, DEPOT),
      ]
    )

    expect(screen.getByText('Anna Andersson · Bosse Bergström')).toBeInTheDocument()
  })

  it('keeps peers with the right shift when the day has two different ones', () => {
    const h8 = `${DAY}T08:00:00.000Z`
    const h13 = `${DAY}T13:00:00.000Z`

    renderWithPeers(
      new Map([
        [`${DEPOT.id}|${h8}`, ['Anna Andersson']],
        [`${SOCIAL_MEDIA.id}|${h13}`, ['Bosse Bergström']],
      ]),
      [
        slot('a1', h8, `${DAY}T09:00:00.000Z`, DEPOT),
        slot('a2', h13, `${DAY}T14:00:00.000Z`, SOCIAL_MEDIA),
      ]
    )

    expect(screen.getByText('Anna Andersson')).toBeInTheDocument()
    expect(screen.getByText('Bosse Bergström')).toBeInTheDocument()
    expect(screen.getAllByText(STRINGS.withYouOnShift)).toHaveLength(2)
  })
})

describe('ScheduleView time view interleaves time off', () => {
  beforeEach(() => localStorage.clear())

  const DAY = '2026-08-12'

  function renderTimeView(
    assignments: AssignmentRow[],
    timeOff: Partial<UnavailabilityPeriod>[] = []
  ) {
    localStorage.setItem('official-schedule-view', 'time')
    return render(
      <ScheduleView
        assignments={assignments}
        days={[DAY]}
        selectedDay={DAY}
        tenantSlug="testklubben"
        strings={STRINGS}
        {...CHECKLIST_PROPS}
        timeOff={timeOff.map((p, i) => ({
          id: `p${i}`,
          official_id: 'off-1',
          reason: null,
          created_by_role: 'official' as const,
          starts_at: '',
          ends_at: '',
          ...p,
        }))}
      />
    )
  }

  it('places an absence before a later shift, in clock order', () => {
    // The whole point: 07:00–08:00 off then 08:00–09:00 on reads as one day,
    // where two stacked blocks made it a comparison exercise.
    const { container } = renderTimeView(
      [slot('a1', `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, DEPOT)],
      [{ starts_at: `${DAY}T07:00:00.000Z`, ends_at: `${DAY}T08:00:00.000Z` }]
    )

    const text = container.textContent ?? ''
    expect(text.indexOf(STRINGS.timeOffOnDay)).toBeLessThan(text.indexOf('Depån'))
  })

  it('places an absence after an earlier shift', () => {
    const { container } = renderTimeView(
      [slot('a1', `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, DEPOT)],
      [{ starts_at: `${DAY}T10:00:00.000Z`, ends_at: `${DAY}T12:00:00.000Z` }]
    )

    const text = container.textContent ?? ''
    expect(text.indexOf('Depån')).toBeLessThan(text.indexOf(STRINGS.timeOffOnDay))
  })

  it('shows the absence times in the timeline gutter', () => {
    renderTimeView([], [{ starts_at: `${DAY}T10:00:00.000Z`, ends_at: `${DAY}T12:00:00.000Z` }])

    expect(screen.getByText(/10:00/)).toBeInTheDocument()
    expect(screen.getByText(/12:00/)).toBeInTheDocument()
  })

  it('renders a whole-day absence as all day rather than 00:00–00:00', () => {
    renderTimeView([], [{ starts_at: `${DAY}T00:00:00.000Z`, ends_at: '2026-08-13T00:00:00.000Z' }])

    expect(screen.getByText(STRINGS.timeOffAllDay)).toBeInTheDocument()
  })

  it('does not also render the separate strip in this view', () => {
    // Both would state the same absence twice on one screen.
    renderTimeView(
      [slot('a1', `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, DEPOT)],
      [{ starts_at: `${DAY}T07:00:00.000Z`, ends_at: `${DAY}T08:00:00.000Z` }]
    )

    expect(screen.getAllByText(STRINGS.timeOffOnDay)).toHaveLength(1)
  })
})

describe('buildTimeline', () => {
  const run = (start: string) =>
    ({ workAreaId: 'ws', span: { start, end: start }, slots: [] }) as never

  const period = (id: string, startsAt: string) =>
    ({
      id,
      official_id: 'off-1',
      starts_at: startsAt,
      ends_at: startsAt,
      reason: null,
    }) as UnavailabilityPeriod

  it('orders by start time across both kinds', () => {
    const merged = buildTimeline(
      [run('2026-08-12T08:00:00.000Z'), run('2026-08-12T14:00:00.000Z')],
      [period('p1', '2026-08-12T10:00:00.000Z')]
    )

    expect(merged.map((e) => e.kind)).toEqual(['shift', 'timeOff', 'shift'])
  })

  it('puts a shift first when both start at the same instant', () => {
    const merged = buildTimeline(
      [run('2026-08-12T08:00:00.000Z')],
      [period('p1', '2026-08-12T08:00:00.000Z')]
    )

    expect(merged.map((e) => e.kind)).toEqual(['shift', 'timeOff'])
  })

  it('compares instants, not strings, across timestamp shapes', () => {
    // PostgREST returns `+00:00` while assignments are normalised to `.000Z`.
    // Sorted as text, `+` sorts below `.` and the absence would jump the queue.
    const merged = buildTimeline(
      [run('2026-08-12T08:00:00.000Z')],
      [period('p1', '2026-08-12T09:00:00+00:00')]
    )

    expect(merged.map((e) => e.kind)).toEqual(['shift', 'timeOff'])
  })
})

describe('ScheduleView shift/time-off clash warning', () => {
  beforeEach(() => localStorage.clear())

  const DAY = '2026-08-12'

  function renderClash({
    view,
    assignments,
    timeOff,
  }: {
    view: 'time' | 'work-area'
    assignments: AssignmentRow[]
    timeOff: UnavailabilityPeriod[]
  }) {
    localStorage.setItem('official-schedule-view', view)
    return render(
      <ScheduleView
        assignments={assignments}
        days={[DAY]}
        selectedDay={DAY}
        tenantSlug="testklubben"
        strings={STRINGS}
        {...CHECKLIST_PROPS}
        timeOff={timeOff}
      />
    )
  }

  function period(overrides: Partial<UnavailabilityPeriod> = {}): UnavailabilityPeriod {
    return {
      id: 'p1',
      official_id: 'off-1',
      starts_at: `${DAY}T08:00:00.000Z`,
      ends_at: `${DAY}T09:00:00.000Z`,
      reason: null,
      created_by_role: 'official',
      ...overrides,
    }
  }

  it('flags a shift that falls inside the official’s own declaration', () => {
    // The admin grid hard-blocks new assignments on a declared period, so this
    // only arises when the time off is booked after the shift already exists.
    // Nothing is cleared then — by design — so the official is the one person
    // who sees both halves, and the only one the app can warn.
    renderClash({
      view: 'time',
      assignments: [slot('a1', `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, DEPOT)],
      timeOff: [period()],
    })

    expect(screen.getByText(STRINGS.timeOffClash)).toBeInTheDocument()
  })

  it('names the organisers when they recorded the time off', () => {
    renderClash({
      view: 'time',
      assignments: [slot('a1', `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, DEPOT)],
      timeOff: [period({ created_by_role: 'tenant_admin' })],
    })

    expect(screen.getByText(STRINGS.timeOffClashAdmin)).toBeInTheDocument()
    expect(screen.queryByText(STRINGS.timeOffClash)).not.toBeInTheDocument()
  })

  it('leaves a shift that merely abuts the absence unflagged', () => {
    // Half-open: starting the minute an absence ends is not a clash, and a
    // chip there would train officials to ignore the real ones.
    renderClash({
      view: 'time',
      assignments: [slot('a1', `${DAY}T09:00:00.000Z`, `${DAY}T10:00:00.000Z`, DEPOT)],
      timeOff: [period()],
    })

    expect(screen.queryByText(STRINGS.timeOffClash)).not.toBeInTheDocument()
    expect(screen.queryByText(STRINGS.timeOffClashAdmin)).not.toBeInTheDocument()
  })

  it('flags the clashing stretch only, on a station worked twice', () => {
    renderClash({
      view: 'work-area',
      assignments: [
        slot('a1', `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, DEPOT),
        slot('a2', `${DAY}T13:00:00.000Z`, `${DAY}T14:00:00.000Z`, DEPOT),
      ],
      timeOff: [period()],
    })

    // One card, two spans, one chip — not a card-level flag that would claim
    // the afternoon stretch clashes too.
    expect(screen.getAllByText(STRINGS.timeOffClash)).toHaveLength(1)
  })

  it('warns in the work-area view as well as the timeline', () => {
    renderClash({
      view: 'work-area',
      assignments: [slot('a1', `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, DEPOT)],
      timeOff: [period()],
    })

    expect(screen.getByText(STRINGS.timeOffClash)).toBeInTheDocument()
  })

  it('shows no chip on a shift with no time off at all', () => {
    renderClash({
      view: 'time',
      assignments: [slot('a1', `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, DEPOT)],
      timeOff: [],
    })

    expect(screen.queryByText(STRINGS.timeOffClash)).not.toBeInTheDocument()
  })
})

describe('ScheduleView time off colour by author', () => {
  beforeEach(() => localStorage.clear())

  const DAY = '2026-08-12'

  function renderPeriod(created_by_role: 'official' | 'tenant_admin') {
    localStorage.setItem('official-schedule-view', 'time')
    return render(
      <ScheduleView
        assignments={[]}
        days={[DAY]}
        selectedDay={DAY}
        tenantSlug="testklubben"
        strings={STRINGS}
        {...CHECKLIST_PROPS}
        timeOff={[
          {
            id: 'p1',
            official_id: 'off-1',
            starts_at: `${DAY}T08:00:00.000Z`,
            ends_at: `${DAY}T09:00:00.000Z`,
            reason: null,
            created_by_role,
          },
        ]}
      />
    )
  }

  // The hue is the only thing separating the two at a glance — the labels
  // differ, but reading them is exactly the work the colour is there to save.
  // It also has to agree with the admin grid's hatch, where amber already
  // means "the official declared this" and slate "the organisers recorded it";
  // a palette that drifted on one side would have the two screens describing
  // the same period differently.
  it("tints the official's own declaration amber", () => {
    const { container } = renderPeriod('official')

    expect(container.querySelector('.bg-orange-50')).not.toBeNull()
    expect(container.querySelector('.bg-slate-50')).toBeNull()
  })

  it('tints an organiser-recorded period slate', () => {
    const { container } = renderPeriod('tenant_admin')

    expect(container.querySelector('.bg-slate-50')).not.toBeNull()
    expect(container.querySelector('.bg-orange-50')).toBeNull()
  })
})

describe('ScheduleView time off disclosure', () => {
  beforeEach(() => {
    localStorage.clear()
    // jsdom implements no layout, so scrollIntoView is simply absent. Stubbed
    // rather than guarded in the component: the call is real behaviour on a
    // phone, where the panel opens below the fold.
    Element.prototype.scrollIntoView = vi.fn()
  })

  const DAY = '2026-08-12'

  function renderAndOpen() {
    const result = render(
      <ScheduleView
        assignments={[]}
        days={[DAY]}
        selectedDay={DAY}
        tenantSlug="testklubben"
        strings={STRINGS}
        {...CHECKLIST_PROPS}
      />
    )
    fireEvent.click(screen.getByText(STRINGS.manageAvailability))
    return result
  }

  it('moves focus into the panel when it opens', () => {
    // Otherwise the disclosure is a trapdoor: content appears below the fold
    // while focus stays on the button, so the next Tab continues past the
    // panel entirely and a screen reader announces nothing.
    renderAndOpen()

    const panel = screen.getByRole('region', { name: STRINGS.manageAvailability })
    expect(document.activeElement).toBe(panel)
  })

  it('scrolls the panel into view', () => {
    renderAndOpen()

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('keeps the panel out of the tab order itself', () => {
    // Focusable programmatically, never a Tab stop: the sequence through the
    // panel should be the controls inside it.
    renderAndOpen()

    expect(
      screen.getByRole('region', { name: STRINGS.manageAvailability }).getAttribute('tabindex')
    ).toBe('-1')
  })

  it('reports its expanded state on the button', () => {
    renderAndOpen()

    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
  })
})

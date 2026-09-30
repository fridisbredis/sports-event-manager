import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChecklistItemRow, type ChecklistCheck } from './checklist-item-row'
import { toggleChecklistItem } from '../actions'
import { WORK_AREA_COLORS } from '@/lib/theme/work-area-colors'

vi.mock('../actions', () => ({
  toggleChecklistItem: vi.fn(() => Promise.resolve({})),
}))

const STRINGS = {
  toggleLabel: 'Check off',
  checkedBy: 'Checked by {{name}} at {{time}}',
  someone: 'someone',
  confirmTitle: 'Are you sure?',
  confirmBody: '{{name}} checked this off. Uncheck it anyway?',
  confirmCancel: 'No, keep it',
  confirmConfirm: 'Yes, uncheck',
  saveFailed: 'Could not save. Try again.',
}

const ME = '11111111-1111-1111-1111-111111111111'
const COLLEAGUE = '22222222-2222-2222-2222-222222222222'

const CHECKBOX_TODO = {
  id: 'todo-1',
  instruction_text: 'Check the cones',
  position: 0,
  item_type: 'checkbox',
}

function renderRow(overrides: { check?: ChecklistCheck | null; todo?: typeof CHECKBOX_TODO } = {}) {
  return render(
    <ul>
      <ChecklistItemRow
        todo={overrides.todo ?? CHECKBOX_TODO}
        check={overrides.check ?? null}
        color={WORK_AREA_COLORS[0]}
        tenantSlug="viadal"
        workstationId="ws-1"
        timeslotStart="2026-10-01T08:00:00.000Z"
        timeslotEnd="2026-10-01T12:00:00.000Z"
        currentUserId={ME}
        strings={STRINGS}
      />
    </ul>
  )
}

const COLLEAGUE_CHECK: ChecklistCheck = {
  checked_by: COLLEAGUE,
  checked_at: '2026-10-01T09:30:00.000Z',
  actorName: 'Bob',
}

const OWN_CHECK: ChecklistCheck = {
  checked_by: ME,
  checked_at: '2026-10-01T09:30:00.000Z',
  actorName: 'Alice',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ChecklistItemRow string contract', () => {
  it('takes only serialisable strings, so it can cross the server boundary', () => {
    // The regression this guards: these strings are built in a Server
    // Component and handed to this Client Component. A callback among them
    // ("(name) => t(...)") type-checks fine but throws at runtime with
    // "Functions cannot be passed directly to Client Components" — which is
    // exactly what shipped and broke MYSCH-01 once.
    for (const [key, value] of Object.entries(STRINGS)) {
      expect(typeof value, `strings.${key} must be a string, not a function`).toBe('string')
    }
  })

  it('interpolates placeholders rather than printing them raw', () => {
    renderRow({ check: COLLEAGUE_CHECK })

    expect(screen.queryByText(/\{\{name\}\}/)).not.toBeInTheDocument()
    expect(screen.getByText('Checked by Bob at 09:30')).toBeInTheDocument()
  })
})

describe('ChecklistItemRow item types', () => {
  it('renders an info item as text with no checkbox', () => {
    renderRow({ todo: { ...CHECKBOX_TODO, item_type: 'info' } })

    expect(screen.getByText('Check the cones')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders a checkbox item as a real, enabled control', () => {
    renderRow()

    const box = screen.getByRole('checkbox')
    expect(box).toBeEnabled()
    expect(box).not.toBeChecked()
  })
})

describe('ChecklistItemRow shared visibility', () => {
  it("shows who checked it and when, so the shift can see a colleague's work", () => {
    renderRow({ check: COLLEAGUE_CHECK })

    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByText('Checked by Bob at 09:30')).toBeInTheDocument()
  })

  it('falls back to a generic actor when the name is gone', () => {
    renderRow({ check: { ...COLLEAGUE_CHECK, actorName: null } })

    expect(screen.getByText('Checked by someone at 09:30')).toBeInTheDocument()
  })
})

describe('ChecklistItemRow checking', () => {
  it('writes the check straight through with no confirmation', async () => {
    renderRow()

    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(toggleChecklistItem).toHaveBeenCalledOnce())
    expect(toggleChecklistItem).toHaveBeenCalledWith(
      expect.objectContaining({
        checked: true,
        todoId: 'todo-1',
        workstationId: 'ws-1',
        timeslotStart: '2026-10-01T08:00:00.000Z',
        timeslotEnd: '2026-10-01T12:00:00.000Z',
      })
    )
    expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument()
  })
})

describe('ChecklistItemRow unchecking', () => {
  it('unchecks your own tick without asking', async () => {
    renderRow({ check: OWN_CHECK })

    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(toggleChecklistItem).toHaveBeenCalledOnce())
    expect(toggleChecklistItem).toHaveBeenCalledWith(expect.objectContaining({ checked: false }))
  })

  it("asks before clearing a colleague's tick", async () => {
    renderRow({ check: COLLEAGUE_CHECK })

    fireEvent.click(screen.getByRole('checkbox'))

    expect(await screen.findByText('Are you sure?')).toBeInTheDocument()
    expect(screen.getByText('Bob checked this off. Uncheck it anyway?')).toBeInTheDocument()
    // Nothing is written until the question is answered.
    expect(toggleChecklistItem).not.toHaveBeenCalled()
  })

  it('does nothing at all when the answer is no', async () => {
    renderRow({ check: COLLEAGUE_CHECK })

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(await screen.findByText('No, keep it'))

    await waitFor(() => expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument())
    // The requirement is explicit: on "no", nothing happens — no write, and
    // therefore no audit row either.
    expect(toggleChecklistItem).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('clears it when the answer is yes', async () => {
    renderRow({ check: COLLEAGUE_CHECK })

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(await screen.findByText('Yes, uncheck'))

    await waitFor(() => expect(toggleChecklistItem).toHaveBeenCalledOnce())
    expect(toggleChecklistItem).toHaveBeenCalledWith(expect.objectContaining({ checked: false }))
  })
})

describe('ChecklistItemRow failure handling', () => {
  it('surfaces a rejected write instead of showing it as saved', async () => {
    vi.mocked(toggleChecklistItem).mockResolvedValueOnce({ error: 'checklist.saveFailed' })
    renderRow()

    fireEvent.click(screen.getByRole('checkbox'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save. Try again.')
    // The box follows the server, never the click: a refused write must not
    // leave it looking ticked.
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
})

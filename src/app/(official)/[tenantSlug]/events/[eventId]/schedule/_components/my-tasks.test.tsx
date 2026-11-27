import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MyTasks, type MyTask } from './my-tasks'
import { toggleMyTaskDone } from '../actions'

vi.mock('../actions', () => ({
  toggleChecklistItem: vi.fn(() => Promise.resolve({})),
  toggleMyTaskDone: vi.fn(() => Promise.resolve({})),
}))

const STRINGS = {
  title: 'My tasks',
  overdue: 'Overdue',
  withYou: 'With you on this task: {{names}}',
  markDone: 'The task is done',
  doneBy: 'Marked done by {{name}} at {{time}}',
}

const CHECKLIST_STRINGS = {
  toggleLabel: 'Check off',
  checkedBy: 'Checked by {{name}} at {{time}}',
  someone: 'someone',
  confirmTitle: 'Are you sure?',
  confirmBody: '{{name}} checked this off. Uncheck it anyway?',
  confirmCancel: 'No, keep it',
  confirmConfirm: 'Yes, uncheck',
  saveFailed: 'Could not save. Try again.',
  saving: 'Saving…',
}

const TASK: MyTask = {
  id: 'task-1',
  name: 'Set up finish arch',
  description: 'Arch is in the shed',
  color: 'sky',
  stageName: 'Day 1',
  starts_at: null,
  // Far in the future, so the task is never overdue whatever day the suite runs.
  deadline: '2099-12-01T10:00:00.000Z',
  doneCheck: null,
  coAssignees: ['Bob'],
}

function renderTasks(tasks: MyTask[]) {
  return render(
    <MyTasks
      tasks={tasks}
      tenantSlug="viadal"
      currentUserId="u-me"
      strings={STRINGS}
      checklistStrings={CHECKLIST_STRINGS}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MyTasks', () => {
  it('renders nothing without tasks', () => {
    const { container } = renderTasks([])
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the task, its stage, notes and co-assignees', () => {
    renderTasks([TASK])
    expect(screen.getByRole('heading', { name: 'My tasks' })).toBeInTheDocument()
    expect(screen.getByText('Set up finish arch')).toBeInTheDocument()
    expect(screen.getByText(/^Day 1 · /)).toBeInTheDocument()
    expect(screen.getByText('With you on this task: Bob')).toBeInTheDocument()
    expect(screen.getByText('Arch is in the shed')).toBeInTheDocument()
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument()
  })

  it('marks an undone task past its deadline as overdue', () => {
    renderTasks([{ ...TASK, deadline: '2000-01-01T10:00:00.000Z' }])
    expect(screen.getByText('Overdue')).toBeInTheDocument()
  })

  it('ticks the task done through toggleMyTaskDone', async () => {
    renderTasks([TASK])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Check off: The task is done' }))
    await waitFor(() =>
      expect(toggleMyTaskDone).toHaveBeenCalledWith({
        tenantSlug: 'viadal',
        id: 'task-1',
        checked: true,
      })
    )
  })

  it('shows who ticked it, and asks before clearing a colleague’s tick', async () => {
    renderTasks([
      {
        ...TASK,
        doneCheck: {
          checked_by: 'u-bob',
          checked_at: '2099-12-01T08:00:00.000Z',
          actorName: 'Bob',
        },
      },
    ])
    expect(screen.getByText(/Marked done by Bob at/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Check off: The task is done' }))
    expect(await screen.findByText('Bob checked this off. Uncheck it anyway?')).toBeInTheDocument()
    expect(toggleMyTaskDone).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Yes, uncheck' }))
    await waitFor(() =>
      expect(toggleMyTaskDone).toHaveBeenCalledWith({
        tenantSlug: 'viadal',
        id: 'task-1',
        checked: false,
      })
    )
  })
})

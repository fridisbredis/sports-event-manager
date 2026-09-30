import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TodosEditor, type TodoDraft } from './todos-editor'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'workstations.todosLabel': 'Checklists / to-dos',
        'workstations.checklistHeading': 'Check-off items',
        'workstations.checklistHint': 'Officials tick these off.',
        'workstations.addChecklistItem': '+ Add check-off item',
        'workstations.checklistPlaceholder': 'e.g. Collect timing chips',
        'workstations.notesHeading': 'Notes',
        'workstations.notesHint': 'Reference only.',
        'workstations.addNote': '+ Add note',
        'workstations.notePlaceholder': 'e.g. Radio channel 3',
        'workstations.removeTodo': 'Remove',
      })[key] ?? key,
  }),
}))

const MIXED: TodoDraft[] = [
  { text: 'Radio channel 3', itemType: 'info' },
  { text: 'Collect timing chips', itemType: 'checkbox' },
  { text: 'Cups by the table', itemType: 'info' },
  { text: 'Hand out medals', itemType: 'checkbox' },
]

/** The list section under a given heading. */
function listFor(heading: string) {
  return screen.getByRole('heading', { name: heading }).closest('div')!.parentElement!
}

function valuesIn(heading: string): string[] {
  return within(listFor(heading))
    .getAllByRole('textbox')
    .map((el) => (el as HTMLInputElement).value)
}

describe('TodosEditor list separation', () => {
  it('splits one array into two lists by kind', () => {
    render(<TodosEditor todos={MIXED} onChange={vi.fn()} />)

    // Interleaved in the source array — each list must show only its own kind,
    // in the relative order the admin gave them.
    expect(valuesIn('Check-off items')).toEqual(['Collect timing chips', 'Hand out medals'])
    expect(valuesIn('Notes')).toEqual(['Radio channel 3', 'Cups by the table'])
  })

  it('renders both headings and their add links when empty', () => {
    render(<TodosEditor todos={[]} onChange={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Check-off items' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.getByText('+ Add check-off item')).toBeInTheDocument()
    expect(screen.getByText('+ Add note')).toBeInTheDocument()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })
})

describe('TodosEditor adding', () => {
  it('adds a checkbox item from the check-off list', () => {
    const onChange = vi.fn()
    render(<TodosEditor todos={MIXED} onChange={onChange} />)

    fireEvent.click(screen.getByText('+ Add check-off item'))

    expect(onChange).toHaveBeenCalledWith([...MIXED, { text: '', itemType: 'checkbox' }])
  })

  it('adds an info item from the notes list', () => {
    const onChange = vi.fn()
    render(<TodosEditor todos={MIXED} onChange={onChange} />)

    fireEvent.click(screen.getByText('+ Add note'))

    expect(onChange).toHaveBeenCalledWith([...MIXED, { text: '', itemType: 'info' }])
  })
})

describe('TodosEditor editing', () => {
  it('edits the right row of the source array, not the row index within its list', () => {
    // The regression this guards: 'Hand out medals' is index 1 of the
    // check-off list but index 3 of the array. Mapping the wrong one would
    // silently rewrite a note instead.
    const onChange = vi.fn()
    render(<TodosEditor todos={MIXED} onChange={onChange} />)

    const input = within(listFor('Check-off items')).getByDisplayValue('Hand out medals')
    fireEvent.change(input, { target: { value: 'Hand out medals and water' } })

    expect(onChange).toHaveBeenCalledWith([
      MIXED[0],
      MIXED[1],
      MIXED[2],
      { text: 'Hand out medals and water', itemType: 'checkbox' },
    ])
  })

  it('removes the right row of the source array', () => {
    const onChange = vi.fn()
    render(<TodosEditor todos={MIXED} onChange={onChange} />)

    // Index within the Notes list (1), matched against that list's own Remove
    // buttons — HeroUI wraps each Input in several divs, so walking up from
    // the field lands on a wrapper that holds no button.
    const removes = within(listFor('Notes')).getAllByText('Remove')
    fireEvent.click(removes[1])

    expect(onChange).toHaveBeenCalledWith([MIXED[0], MIXED[1], MIXED[3]])
  })

  it('keeps a checkbox item checkable when its text is edited', () => {
    const onChange = vi.fn()
    render(<TodosEditor todos={MIXED} onChange={onChange} />)

    const input = within(listFor('Check-off items')).getByDisplayValue('Collect timing chips')
    fireEvent.change(input, { target: { value: 'Collect chips' } })

    const next = onChange.mock.calls[0][0] as TodoDraft[]
    expect(next.filter((t) => t.itemType === 'checkbox')).toHaveLength(2)
  })
})

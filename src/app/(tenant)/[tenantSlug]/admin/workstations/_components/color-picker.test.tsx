import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ColorPicker } from './color-picker'
import { WORK_AREA_COLORS } from '@/lib/theme/work-area-colors'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      ({
        'workstations.colorLabel': 'Color',
        'workstations.colorHint': 'Used to tell this area apart on the schedule.',
        'workstations.colorTakenHint':
          "A line through a color means it's already used by another work area (hover to see which).",
        'workstations.colorTakenBy': `Already used by ${vars?.name}`,
        'workstations.colorSwatchLabel': `Color ${vars?.index} of ${vars?.total}`,
      })[key] ?? key,
  }),
}))

/** Every swatch, in palette order. */
function swatches() {
  return screen.getAllByRole('button')
}

describe('ColorPicker', () => {
  it('renders one swatch per palette colour', () => {
    render(<ColorPicker value={null} takenBy={[]} onChange={vi.fn()} />)

    expect(swatches()).toHaveLength(WORK_AREA_COLORS.length)
  })

  it('marks the selected colour as pressed, and only that one', () => {
    render(<ColorPicker value="jade" takenBy={[]} onChange={vi.fn()} />)

    const pressed = swatches().filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    const jadeIndex = WORK_AREA_COLORS.findIndex((c) => c.name === 'jade')
    expect(swatches()[jadeIndex]).toBe(pressed[0])
  })

  it('marks nothing as pressed when no colour is chosen', () => {
    render(<ColorPicker value={null} takenBy={[]} onChange={vi.fn()} />)

    expect(swatches().filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(0)
  })

  it('reports the chosen palette name on click', () => {
    const onChange = vi.fn()
    render(<ColorPicker value={null} takenBy={[]} onChange={onChange} />)

    fireEvent.click(swatches()[4])

    expect(onChange).toHaveBeenCalledWith(WORK_AREA_COLORS[4].name)
  })

  it('names the work area holding a taken colour', () => {
    render(
      <ColorPicker
        value={null}
        takenBy={[{ color: 'rose', name: 'Finish line' }]}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Already used by Finish line')).toBeInTheDocument()
  })

  it('names every holder when several share one colour', () => {
    // Sharing is allowed, so the marker has to account for all of them rather
    // than silently naming whichever came last.
    render(
      <ColorPicker
        value={null}
        takenBy={[
          { color: 'rose', name: 'Finish line' },
          { color: 'rose', name: 'Water station' },
        ]}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Already used by Finish line, Water station')).toBeInTheDocument()
  })

  it('does not mark a colour the work area itself already holds', () => {
    // Its own colour arriving in `takenBy` would otherwise strike through the
    // current selection, telling the admin their own choice is unavailable.
    render(
      <ColorPicker
        value="rose"
        takenBy={[{ color: 'rose', name: 'This work area' }]}
        onChange={vi.fn()}
      />
    )

    expect(screen.queryByLabelText(/Already used by/)).not.toBeInTheDocument()
  })

  it('leaves a taken colour selectable', () => {
    // The marker is advice, not a lock — a large event can legitimately need
    // to reuse one, and blocking the save would be worse than the clash.
    const onChange = vi.fn()
    render(
      <ColorPicker
        value={null}
        takenBy={[{ color: WORK_AREA_COLORS[2].name, name: 'Finish line' }]}
        onChange={onChange}
      />
    )

    fireEvent.click(swatches()[2])

    expect(onChange).toHaveBeenCalledWith(WORK_AREA_COLORS[2].name)
  })

  it('explains the markers only when something is actually marked', () => {
    const { rerender } = render(<ColorPicker value={null} takenBy={[]} onChange={vi.fn()} />)
    expect(screen.queryByText(/A line through a color/)).not.toBeInTheDocument()

    rerender(
      <ColorPicker
        value={null}
        takenBy={[{ color: 'rose', name: 'Finish line' }]}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText(/A line through a color/)).toBeInTheDocument()
  })

  it('ignores a taken colour that is not in the palette', () => {
    // A name retired from the palette can still sit in a row; it must not
    // mark an unrelated swatch or crash the picker.
    render(
      <ColorPicker
        value={null}
        takenBy={[{ color: 'teal2', name: 'Old area' }]}
        onChange={vi.fn()}
      />
    )

    expect(screen.queryByLabelText(/Already used by/)).not.toBeInTheDocument()
    expect(swatches()).toHaveLength(WORK_AREA_COLORS.length)
  })
})

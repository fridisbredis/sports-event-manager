import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OperatingWindowsEditor } from './operating-windows-editor'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'workstations.operatingWindowsLabel': 'Operating windows',
        'workstations.operatingWindowMidnightHint': 'To run until midnight, set 00:00.',
        'workstations.addWindow': '+ Add window',
        'workstations.removeWindow': 'Remove',
        'workstations.matchStageHours': 'Match stage hours',
        'workstations.windowStartLabel': 'Start',
        'workstations.windowEndLabel': 'End',
        'workstations.limitToOneDay': 'Limit to one day',
        'workstations.noOperatingWindows':
          "No operating windows set — this area won't appear on the schedule until you add one.",
      })[key] ?? key,
  }),
}))

const BASE = {
  errors: undefined,
  isMultiDay: false,
  stageDays: [],
  canMatchStageHours: false,
  minStartFor: undefined,
  maxEndFor: () => undefined,
  onUpdateWindow: vi.fn(),
  onRemoveWindow: vi.fn(),
  onAddWindow: vi.fn(),
  onToggleLimitToDay: vi.fn(),
  onSetLimitDay: vi.fn(),
  onMatchStageHours: vi.fn(),
}

describe('OperatingWindowsEditor empty state', () => {
  it('explains the consequence when no window is set', () => {
    render(<OperatingWindowsEditor {...BASE} windows={[]} />)

    // Not just "nothing here": a work area without a window never reaches the
    // schedule at all, which the admin has no other way to find out.
    expect(
      screen.getByText(
        "No operating windows set — this area won't appear on the schedule until you add one."
      )
    ).toBeInTheDocument()
  })

  it('still offers the add link when empty', () => {
    render(<OperatingWindowsEditor {...BASE} windows={[]} />)

    expect(screen.getByText('+ Add window')).toBeInTheDocument()
  })

  it('drops the empty state once a window exists', () => {
    render(
      <OperatingWindowsEditor
        {...BASE}
        windows={[{ start: '07:00', end: '18:00', limitToDay: null }]}
      />
    )

    expect(screen.queryByText(/No operating windows set/)).not.toBeInTheDocument()
    expect(screen.getByText('Remove')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import en from '../../../../../../../public/locales/en/admin.json'
import { SchedulingCellLegend, SchedulingWarningLegend } from './scheduling-legend'

// Resolve against the real locale file rather than a hand-written map, so a
// renamed or deleted key fails here instead of silently rendering its own
// name as the label.
vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // admin.json nests a few groups, so walk the path rather than assuming
      // one level — and surface a missing key instead of echoing it back.
      const value = key
        .split('.')
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
          en
        )
      if (typeof value !== 'string') throw new Error(`missing translation key: ${key}`)
      return value
    },
  }),
}))

const S = en.scheduling

/**
 * What this guards: the legend is split by where each entry belongs, and the
 * cell half says different things in the two views. by-work-area reads a
 * slot's fill against its ceiling and an empty cell is a vacancy; by-person
 * shows which work area someone is on, where that same count is secondary
 * detail inside a shift card and an empty cell means the person is free.
 * Showing one view's wording in the other is wrong but entirely silent.
 */
describe('SchedulingCellLegend', () => {
  describe('by-work-area', () => {
    it('explains capacity, which is what an empty cell reports in this view', () => {
      render(<SchedulingCellLegend view="by-work-area" />)

      expect(screen.getByText(S.legendCapacity)).toBeTruthy()
    })

    it('names a filled cell as a filled slot', () => {
      render(<SchedulingCellLegend view="by-work-area" />)

      expect(screen.getByText(S.legendFilled)).toBeTruthy()
      expect(screen.queryByText(S.legendShift)).toBeNull()
    })

    it('names an empty cell as an open place', () => {
      render(<SchedulingCellLegend view="by-work-area" />)

      expect(screen.getByText(S.legendAssignable)).toBeTruthy()
      expect(screen.queryByText(S.legendFree)).toBeNull()
    })
  })

  describe('by-person', () => {
    it('drops capacity, which this view only shows inside a shift card', () => {
      render(<SchedulingCellLegend view="by-person" />)

      expect(screen.queryByText(S.legendCapacity)).toBeNull()
    })

    it('names a filled cell as the shift that person is on', () => {
      render(<SchedulingCellLegend view="by-person" />)

      expect(screen.getByText(S.legendShift)).toBeTruthy()
      expect(screen.queryByText(S.legendFilled)).toBeNull()
    })

    it('names an empty cell as a free person, not an open place', () => {
      render(<SchedulingCellLegend view="by-person" />)

      expect(screen.getByText(S.legendFree)).toBeTruthy()
      expect(screen.queryByText(S.legendAssignable)).toBeNull()
    })
  })

  it('explains the hatching in both views, which means the same thing in each', () => {
    const { unmount } = render(<SchedulingCellLegend view="by-work-area" />)
    expect(screen.getByText(S.legendOutsideWindow)).toBeTruthy()
    unmount()

    render(<SchedulingCellLegend view="by-person" />)
    expect(screen.getByText(S.legendOutsideWindow)).toBeTruthy()
  })

  it('keeps the warning entries out of the card, where they would crowd the grid', () => {
    render(<SchedulingCellLegend view="by-work-area" />)

    expect(screen.queryByText(S.legendDoubleBooked)).toBeNull()
    expect(screen.queryByText(S.legendOverCapacity)).toBeNull()
    expect(screen.queryByText(S.legendTimeOff)).toBeNull()
  })
})

describe('SchedulingWarningLegend', () => {
  it('carries every conflict and absence marker', () => {
    render(<SchedulingWarningLegend />)

    for (const label of [
      S.legendDoubleBooked,
      S.legendOverCapacity,
      S.legendTimeOff,
      S.legendTimeOffAdmin,
      S.legendClashTimeOff,
    ]) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('leaves the cell-state entries to the legend inside the card', () => {
    render(<SchedulingWarningLegend />)

    expect(screen.queryByText(S.legendCapacity)).toBeNull()
    expect(screen.queryByText(S.legendOutsideWindow)).toBeNull()
  })
})

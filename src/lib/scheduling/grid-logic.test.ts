import { describe, it, expect } from 'vitest'
import {
  computeOverCapacityCells,
  computeOverCapacityDetails,
  computeDoubleBookedOfficials,
  computeDoubleBookedDetails,
  generateSlotsForDay,
  isWithinWindow,
  getCurrentStage,
  formatDayLabel,
} from './grid-logic'

// These two functions back the warning badges in SCHED-01:
// - computeOverCapacityCells → "by-work-area" view (too many officials in one slot)
// - computeDoubleBookedOfficials → "by-person" view (one official in two places at once)

describe('computeOverCapacityCells (by-work-area)', () => {
  const workstations = [{ id: 'ws-1', capacity_ceiling: 2 }]

  it('flags a slot once assignments exceed the capacity ceiling', () => {
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
      { official_id: 'o2', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
      { official_id: 'o3', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
    ]

    const result = computeOverCapacityCells(assignments, workstations)

    expect(result).toEqual(new Set(['ws-1:2026-08-10T08:00:00.000Z']))
  })

  it('does not flag a slot at or below the capacity ceiling', () => {
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
      { official_id: 'o2', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
    ]

    expect(computeOverCapacityCells(assignments, workstations)).toEqual(new Set())
  })

  it('tracks each work area and timeslot as an independent cell', () => {
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
      { official_id: 'o2', workstation_id: 'ws-1', timeslot_start: '2026-08-10T09:00:00.000Z' },
    ]

    expect(computeOverCapacityCells(assignments, workstations)).toEqual(new Set())
  })

  it('ignores assignments for workstations outside the current stage', () => {
    const assignments = [
      {
        official_id: 'o1',
        workstation_id: 'ws-unknown',
        timeslot_start: '2026-08-10T08:00:00.000Z',
      },
      {
        official_id: 'o2',
        workstation_id: 'ws-unknown',
        timeslot_start: '2026-08-10T08:00:00.000Z',
      },
      {
        official_id: 'o3',
        workstation_id: 'ws-unknown',
        timeslot_start: '2026-08-10T08:00:00.000Z',
      },
    ]

    expect(computeOverCapacityCells(assignments, workstations)).toEqual(new Set())
  })
})

describe('computeOverCapacityDetails', () => {
  it('resolves work area and official names and reports the count against the ceiling', () => {
    const workstations = [{ id: 'ws-1', name: 'Start line', capacity_ceiling: 1 }]
    const officials = [
      { id: 'o1', name: 'Frida' },
      { id: 'o2', name: 'Mikael Saras' },
    ]
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-06T12:00:00.000Z' },
      { official_id: 'o2', workstation_id: 'ws-1', timeslot_start: '2026-08-06T12:00:00.000Z' },
    ]
    const overCapacityCells = computeOverCapacityCells(assignments, workstations)

    const details = computeOverCapacityDetails(
      overCapacityCells,
      assignments,
      workstations,
      officials
    )

    expect(details).toHaveLength(1)
    expect(details[0].workAreaName).toBe('Start line')
    expect(details[0].count).toBe(2)
    expect(details[0].ceiling).toBe(1)
    expect(details[0].officialNames.sort()).toEqual(['Frida', 'Mikael Saras'])
  })

  it('lists one entry per over-capacity timeslot, even for the same work area', () => {
    const workstations = [{ id: 'ws-1', name: 'Start line', capacity_ceiling: 1 }]
    const officials = [
      { id: 'o1', name: 'Frida' },
      { id: 'o2', name: 'Mikael Saras' },
      { id: 'o3', name: 'Anna Andersson' },
    ]
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-06T12:00:00.000Z' },
      { official_id: 'o2', workstation_id: 'ws-1', timeslot_start: '2026-08-06T12:00:00.000Z' },
      { official_id: 'o2', workstation_id: 'ws-1', timeslot_start: '2026-08-06T14:00:00.000Z' },
      { official_id: 'o3', workstation_id: 'ws-1', timeslot_start: '2026-08-06T14:00:00.000Z' },
    ]
    const overCapacityCells = computeOverCapacityCells(assignments, workstations)

    const details = computeOverCapacityDetails(
      overCapacityCells,
      assignments,
      workstations,
      officials
    )

    expect(details).toHaveLength(2)
    expect(details.every((d) => d.workAreaName === 'Start line' && d.count === 2)).toBe(true)
  })
})

describe('computeOverCapacityDetails — locale', () => {
  it("formats the over-capacity time in the reader's locale", () => {
    const workstations = [{ id: 'ws-1', name: 'Start line', capacity_ceiling: 1 }]
    const officials = [
      { id: 'o1', name: 'Frida' },
      { id: 'o2', name: 'Mikael Saras' },
    ]
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-06T12:00:00.000Z' },
      { official_id: 'o2', workstation_id: 'ws-1', timeslot_start: '2026-08-06T12:00:00.000Z' },
    ]
    const cells = computeOverCapacityCells(assignments, workstations)

    const en = computeOverCapacityDetails(cells, assignments, workstations, officials, 'en')
    const sv = computeOverCapacityDetails(cells, assignments, workstations, officials, 'sv')

    expect(en[0].time).toBe('6 Aug 12:00')
    expect(sv[0].time).toBe('6 aug. 12:00')
  })
})

describe('computeDoubleBookedOfficials (by-person)', () => {
  it('flags an official assigned to two different work areas at the same time', () => {
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
      { official_id: 'o1', workstation_id: 'ws-2', timeslot_start: '2026-08-10T08:00:00.000Z' },
    ]

    const result = computeDoubleBookedOfficials(assignments)

    expect(result).toEqual(new Set(['o1:2026-08-10T08:00:00.000Z']))
  })

  it('does not flag the same official at the same work area twice (no-op resave)', () => {
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
    ]

    expect(computeDoubleBookedOfficials(assignments)).toEqual(new Set())
  })

  it('does not flag one official across two different, non-overlapping timeslots', () => {
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
      { official_id: 'o1', workstation_id: 'ws-2', timeslot_start: '2026-08-10T09:00:00.000Z' },
    ]

    expect(computeDoubleBookedOfficials(assignments)).toEqual(new Set())
  })

  it('does not flag two different officials at the same work area and time', () => {
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
      { official_id: 'o2', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
    ]

    expect(computeDoubleBookedOfficials(assignments)).toEqual(new Set())
  })
})

describe('computeDoubleBookedDetails', () => {
  it('resolves ids to display names and lists each conflicting work area once', () => {
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
      { official_id: 'o1', workstation_id: 'ws-2', timeslot_start: '2026-08-10T08:00:00.000Z' },
    ]
    const officials = [{ id: 'o1', name: 'Anna Andersson' }]
    const workstations = [
      { id: 'ws-1', name: 'Start' },
      { id: 'ws-2', name: 'Vätska' },
    ]
    const doubleBooked = computeDoubleBookedOfficials(assignments)

    const details = computeDoubleBookedDetails(doubleBooked, assignments, officials, workstations)

    expect(details).toHaveLength(1)
    expect(details[0].officialName).toBe('Anna Andersson')
    expect(details[0].workAreaNames.sort()).toEqual(['Start', 'Vätska'])
  })

  // The conflict time carries a date as well as a clock, so it follows the
  // reader's language — unlike a bare HH:mm, which both locales agree on.
  it("formats the conflict time in the English reader's locale", () => {
    const assignments = [
      { official_id: 'o1', workstation_id: 'ws-1', timeslot_start: '2026-08-10T08:00:00.000Z' },
      { official_id: 'o1', workstation_id: 'ws-2', timeslot_start: '2026-08-10T08:00:00.000Z' },
    ]
    const officials = [{ id: 'o1', name: 'Anna Andersson' }]
    const workstations = [
      { id: 'ws-1', name: 'Start' },
      { id: 'ws-2', name: 'Vätska' },
    ]
    const doubleBooked = computeDoubleBookedOfficials(assignments)

    const en = computeDoubleBookedDetails(doubleBooked, assignments, officials, workstations, 'en')
    const sv = computeDoubleBookedDetails(doubleBooked, assignments, officials, workstations, 'sv')

    expect(en[0].time).toBe('10 Aug 08:00')
    expect(sv[0].time).toBe('10 aug. 08:00')
  })
})

describe('generateSlotsForDay', () => {
  const stage = {
    stage_type: 'other',
    start_time: '2026-08-10T08:00:00.000Z',
    end_time: '2026-08-10T10:00:00.000Z',
  }

  it('produces evenly spaced slots at the given granularity', () => {
    const slots = generateSlotsForDay(stage, '2026-08-10', 30)

    expect(slots.map((s) => s.toISOString())).toEqual([
      '2026-08-10T08:00:00.000Z',
      '2026-08-10T08:30:00.000Z',
      '2026-08-10T09:00:00.000Z',
      '2026-08-10T09:30:00.000Z',
    ])
  })

  it('clips slots to the requested day when the stage spans multiple days', () => {
    const multiDayStage = {
      stage_type: 'other',
      start_time: '2026-08-10T22:00:00.000Z',
      end_time: '2026-08-11T02:00:00.000Z',
    }

    const day1 = generateSlotsForDay(multiDayStage, '2026-08-10', 60)
    const day2 = generateSlotsForDay(multiDayStage, '2026-08-11', 60)

    expect(day1.map((s) => s.toISOString())).toEqual([
      '2026-08-10T22:00:00.000Z',
      '2026-08-10T23:00:00.000Z',
    ])
    expect(day2.map((s) => s.toISOString())).toEqual([
      '2026-08-11T00:00:00.000Z',
      '2026-08-11T01:00:00.000Z',
    ])
  })

  it('applies the one-hour race buffer before and after a race stage', () => {
    const raceStage = {
      stage_type: 'race',
      start_time: '2026-08-10T09:00:00.000Z',
      end_time: '2026-08-10T09:00:00.000Z',
    }

    const slots = generateSlotsForDay(raceStage, '2026-08-10', 60)

    expect(slots[0].toISOString()).toBe('2026-08-10T08:00:00.000Z')
    expect(slots[slots.length - 1].toISOString()).toBe('2026-08-10T09:00:00.000Z')
  })

  it('returns no slots for a day the stage does not cover', () => {
    expect(generateSlotsForDay(stage, '2026-08-11', 30)).toEqual([])
  })
})

describe('isWithinWindow', () => {
  const windows = [
    { window_start: '2026-08-10T08:00:00.000Z', window_end: '2026-08-10T09:00:00.000Z' },
  ]

  it('allows a slot fully inside an operating window', () => {
    expect(isWithinWindow(new Date('2026-08-10T08:00:00.000Z'), 30, windows)).toBe(true)
  })

  it('blocks a slot that ends after the operating window closes', () => {
    expect(isWithinWindow(new Date('2026-08-10T08:45:00.000Z'), 30, windows)).toBe(false)
  })

  it('allows any slot when no operating windows are configured', () => {
    expect(isWithinWindow(new Date('2026-08-10T23:00:00.000Z'), 30, [])).toBe(true)
  })

  // A round-the-clock work area is stored as one window per calendar day
  // (expandWindows in admin/workstations/_utils.ts), so its windows meet
  // exactly at midnight rather than forming one long span. A slot straddling
  // that seam fits inside neither window on its own.
  describe('across adjacent windows', () => {
    const roundTheClock = [
      { window_start: '2026-10-16T00:00:00.000Z', window_end: '2026-10-17T00:00:00.000Z' },
      { window_start: '2026-10-17T00:00:00.000Z', window_end: '2026-10-18T00:00:00.000Z' },
    ]

    it('allows a slot straddling the seam between two touching windows', () => {
      // 23:15 + 60min = 00:15 — past the first window's end, before the
      // second's start. The area is open continuously; the cell must not be
      // hatched as closed.
      expect(isWithinWindow(new Date('2026-10-16T23:15:00.000Z'), 60, roundTheClock)).toBe(true)
    })

    it('allows a slot that lands exactly on the seam', () => {
      expect(isWithinWindow(new Date('2026-10-17T00:00:00.000Z'), 60, roundTheClock)).toBe(true)
    })

    it('still blocks a slot straddling a real gap between windows', () => {
      // The check's actual purpose: a genuine closure between two shifts.
      const withGap = [
        { window_start: '2026-10-16T08:00:00.000Z', window_end: '2026-10-16T12:00:00.000Z' },
        { window_start: '2026-10-16T13:00:00.000Z', window_end: '2026-10-16T17:00:00.000Z' },
      ]
      expect(isWithinWindow(new Date('2026-10-16T11:30:00.000Z'), 60, withGap)).toBe(false)
      expect(isWithinWindow(new Date('2026-10-16T12:00:00.000Z'), 60, withGap)).toBe(false)
    })

    it('merges overlapping windows as well as touching ones', () => {
      const overlapping = [
        { window_start: '2026-10-16T08:00:00.000Z', window_end: '2026-10-16T12:00:00.000Z' },
        { window_start: '2026-10-16T11:00:00.000Z', window_end: '2026-10-16T16:00:00.000Z' },
      ]
      expect(isWithinWindow(new Date('2026-10-16T11:30:00.000Z'), 60, overlapping)).toBe(true)
    })

    it('does not depend on the windows arriving in chronological order', () => {
      const reversed = [...roundTheClock].reverse()
      expect(isWithinWindow(new Date('2026-10-16T23:15:00.000Z'), 60, reversed)).toBe(true)
    })

    it('still blocks a slot outside every window', () => {
      expect(isWithinWindow(new Date('2026-10-18T00:30:00.000Z'), 60, roundTheClock)).toBe(false)
    })
  })
})

describe('getCurrentStage', () => {
  it('picks the stage whose allocable range contains now', () => {
    const now = new Date()
    const past = {
      id: 'past',
      stage_type: 'other',
      start_time: new Date(now.getTime() - 7200_000).toISOString(),
      end_time: new Date(now.getTime() - 3600_000).toISOString(),
    }
    const current = {
      id: 'current',
      stage_type: 'other',
      start_time: new Date(now.getTime() - 1800_000).toISOString(),
      end_time: new Date(now.getTime() + 1800_000).toISOString(),
    }

    expect(getCurrentStage([past, current])?.id).toBe('current')
  })

  it('returns undefined when no stage covers now', () => {
    const past = {
      id: 'past',
      stage_type: 'other',
      start_time: '2020-01-01T08:00:00.000Z',
      end_time: '2020-01-01T09:00:00.000Z',
    }

    expect(getCurrentStage([past])).toBeUndefined()
  })
})

describe('formatDayLabel', () => {
  // The day selector showed Swedish names to English readers because the
  // call site dropped the language, and a CSS `capitalize` then title-cased
  // every word of the Swedish label.
  it('uses English names with a short weekday for an English reader', () => {
    expect(formatDayLabel('2026-07-12', 'en')).toBe('Sun, 12 Jul')
  })

  it('uses Swedish names with a long, lower-case weekday for a Swedish reader', () => {
    expect(formatDayLabel('2026-08-02', 'sv')).toBe('söndag 2 aug.')
  })

  it('falls back to the regional default when the language is unknown', () => {
    expect(formatDayLabel('2026-08-02')).toBe('söndag 2 aug.')
  })
})

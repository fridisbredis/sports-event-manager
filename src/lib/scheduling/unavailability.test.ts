import { describe, it, expect } from 'vitest'
import {
  periodsOverlap,
  buildUnavailableSlotKeys,
  periodsCoveringSlot,
  findUnavailableAssignments,
  type UnavailabilityPeriod,
} from './unavailability'

// Dates are derived, never literal: the seed is relative to today, and a
// hard-coded date in a test here ages out overnight.
const DAY = new Date()
DAY.setUTCHours(0, 0, 0, 0)

/** `at(9)` → today 09:00 UTC. Fractions allowed: `at(9.5)` → 09:30. */
function at(hour: number): string {
  return new Date(DAY.getTime() + hour * 60 * 60 * 1000).toISOString()
}

function slotsFrom(startHour: number, count: number, granularityMin = 60): Date[] {
  const slots: Date[] = []
  for (let i = 0; i < count; i++) {
    slots.push(new Date(DAY.getTime() + (startHour * 60 + i * granularityMin) * 60 * 1000))
  }
  return slots
}

function period(overrides: Partial<UnavailabilityPeriod> = {}): UnavailabilityPeriod {
  return {
    id: 'p1',
    official_id: 'off-1',
    starts_at: at(9),
    ends_at: at(12),
    reason: null,
    ...overrides,
  }
}

describe('periodsOverlap', () => {
  it('detects a straightforward overlap', () => {
    expect(periodsOverlap(at(9), at(12), at(11), at(13))).toBe(true)
  })

  it('treats touching intervals as non-overlapping (half-open)', () => {
    // An absence ending 12:00 and a shift starting 12:00 are adjacent. This is
    // the convention the DB CHECK and both screens share.
    expect(periodsOverlap(at(9), at(12), at(12), at(13))).toBe(false)
    expect(periodsOverlap(at(12), at(13), at(9), at(12))).toBe(false)
  })

  it('detects full containment in both directions', () => {
    expect(periodsOverlap(at(9), at(17), at(11), at(12))).toBe(true)
    expect(periodsOverlap(at(11), at(12), at(9), at(17))).toBe(true)
  })

  it('returns false for disjoint intervals', () => {
    expect(periodsOverlap(at(9), at(10), at(14), at(15))).toBe(false)
  })

  it('accepts Date and string inputs interchangeably', () => {
    expect(periodsOverlap(new Date(at(9)), at(12), at(11), new Date(at(13)))).toBe(true)
  })

  it('matches across the timestamp shapes PostgREST can return', () => {
    // `...T09:00:00+00:00` and `...T09:00:00.000Z` are the same instant, and
    // both come back from PostgREST depending on the column and the driver.
    const offsetShape = at(9).replace('.000Z', '+00:00')
    expect(periodsOverlap(offsetShape, at(12), at(11), at(13))).toBe(true)
  })
})

describe('buildUnavailableSlotKeys', () => {
  it('keys every slot a period covers', () => {
    const slots = slotsFrom(8, 6) // 08:00..13:00
    const keys = buildUnavailableSlotKeys(
      [period({ starts_at: at(9), ends_at: at(12) })],
      slots,
      60
    )

    expect(keys.has(`off-1:${at(8)}`)).toBe(false)
    expect(keys.has(`off-1:${at(9)}`)).toBe(true)
    expect(keys.has(`off-1:${at(10)}`)).toBe(true)
    expect(keys.has(`off-1:${at(11)}`)).toBe(true)
    // 12:00 slot starts exactly where the period ends — not covered.
    expect(keys.has(`off-1:${at(12)}`)).toBe(false)
  })

  it('covers a slot a period only partially overlaps', () => {
    // A period 09:30–10:00 covers none of the 09:00 slot's start but overlaps
    // it. Declining half a slot declines the slot — the grid cannot render
    // half a cell, and under-reporting would hide a real conflict.
    const keys = buildUnavailableSlotKeys(
      [period({ starts_at: at(9.5), ends_at: at(10) })],
      slotsFrom(9, 2),
      60
    )
    expect(keys.has(`off-1:${at(9)}`)).toBe(true)
    expect(keys.has(`off-1:${at(10)}`)).toBe(false)
  })

  it('keeps officials separate', () => {
    const keys = buildUnavailableSlotKeys(
      [period({ official_id: 'off-1' }), period({ id: 'p2', official_id: 'off-2' })],
      slotsFrom(9, 2),
      60
    )
    expect(keys.has(`off-1:${at(9)}`)).toBe(true)
    expect(keys.has(`off-2:${at(9)}`)).toBe(true)
    expect(keys.has(`off-3:${at(9)}`)).toBe(false)
  })

  it('honours a non-hourly granularity', () => {
    const slots = slotsFrom(9, 4, 30) // 09:00, 09:30, 10:00, 10:30
    const keys = buildUnavailableSlotKeys(
      [period({ starts_at: at(9.5), ends_at: at(10) })],
      slots,
      30
    )
    expect(keys.has(`off-1:${at(9)}`)).toBe(false)
    expect(keys.has(`off-1:${at(9.5)}`)).toBe(true)
    expect(keys.has(`off-1:${at(10)}`)).toBe(false)
  })

  it('returns an empty set for no periods', () => {
    expect(buildUnavailableSlotKeys([], slotsFrom(9, 3), 60).size).toBe(0)
  })

  it('unions overlapping periods rather than double-counting', () => {
    const keys = buildUnavailableSlotKeys(
      [
        period({ id: 'p1', starts_at: at(9), ends_at: at(11) }),
        period({ id: 'p2', starts_at: at(10), ends_at: at(12) }),
      ],
      slotsFrom(9, 4),
      60
    )
    expect(keys.has(`off-1:${at(9)}`)).toBe(true)
    expect(keys.has(`off-1:${at(10)}`)).toBe(true)
    expect(keys.has(`off-1:${at(11)}`)).toBe(true)
    expect(keys.size).toBe(3)
  })
})

describe('periodsCoveringSlot', () => {
  it('returns the periods covering the slot, with their reasons', () => {
    const found = periodsCoveringSlot(
      [period({ reason: 'Working' }), period({ id: 'p2', starts_at: at(14), ends_at: at(16) })],
      'off-1',
      new Date(at(10)),
      60
    )
    expect(found).toHaveLength(1)
    expect(found[0].reason).toBe('Working')
  })

  it('ignores another official’s periods', () => {
    const found = periodsCoveringSlot(
      [period({ official_id: 'off-2' })],
      'off-1',
      new Date(at(10)),
      60
    )
    expect(found).toHaveLength(0)
  })
})

describe('findUnavailableAssignments', () => {
  const assignment = (officialId: string, hour: number) => ({
    id: `a-${officialId}-${hour}`,
    official_id: officialId,
    timeslot_start: at(hour),
    timeslot_end: at(hour + 1),
  })

  it('finds assignments that fall inside a declared period', () => {
    const conflicts = findUnavailableAssignments(
      [assignment('off-1', 10), assignment('off-1', 14)],
      [period({ starts_at: at(9), ends_at: at(12) })]
    )
    expect(conflicts.map((a) => a.id)).toEqual(['a-off-1-10'])
  })

  it('returns nothing when there are no periods', () => {
    expect(findUnavailableAssignments([assignment('off-1', 10)], [])).toEqual([])
  })

  it('does not flag an assignment that merely touches a period', () => {
    const conflicts = findUnavailableAssignments(
      [assignment('off-1', 12)],
      [period({ starts_at: at(9), ends_at: at(12) })]
    )
    expect(conflicts).toEqual([])
  })

  it('matches each official against only their own periods', () => {
    const conflicts = findUnavailableAssignments(
      [assignment('off-1', 10), assignment('off-2', 10)],
      [period({ official_id: 'off-2', starts_at: at(9), ends_at: at(12) })]
    )
    expect(conflicts.map((a) => a.official_id)).toEqual(['off-2'])
  })
})

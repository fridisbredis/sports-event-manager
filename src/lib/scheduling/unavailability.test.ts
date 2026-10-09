import { describe, it, expect } from 'vitest'
import {
  periodsOverlap,
  buildUnavailableSlotKeys,
  periodsCoveringSlot,
  findUnavailableAssignments,
  mergeAdjacentPeriods,
  clashingAuthor,
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

describe('mergeAdjacentPeriods', () => {
  const p = (
    id: string,
    startHour: number,
    endHour: number,
    overrides: Partial<UnavailabilityPeriod> = {}
  ): UnavailabilityPeriod => ({
    id,
    official_id: 'off-1',
    starts_at: at(startHour),
    ends_at: at(endHour),
    reason: null,
    created_by_role: 'tenant_admin',
    ...overrides,
  })

  it('joins touching periods into one span', () => {
    // Three drags across one row store three rows. Rendered as three lines
    // they read as three unrelated absences, when the person is simply away
    // 07:00–10:00 — this is the bug the merge exists for.
    const merged = mergeAdjacentPeriods([p('a', 7, 8), p('b', 8, 9), p('c', 9, 10)])

    expect(merged).toHaveLength(1)
    expect(merged[0].starts_at).toBe(at(7))
    expect(merged[0].ends_at).toBe(at(10))
  })

  // A timed range declared over several days is stored as one period per day
  // (toPeriodBounds). Those must stay separate lines: 10:00-11:00 on three
  // consecutive days is three short absences, and merging them would redraw
  // them as one 49-hour block — the exact shape this change moved away from.
  it('keeps the same hour on consecutive days as separate spans', () => {
    const merged = mergeAdjacentPeriods([
      p('d1', 10, 11),
      p('d2', 24 + 10, 24 + 11),
      p('d3', 48 + 10, 48 + 11),
    ])

    expect(merged).toHaveLength(3)
    expect(merged.map((m) => m.starts_at)).toEqual([at(10), at(34), at(58)])
  })

  it('keeps a real gap as two spans', () => {
    const merged = mergeAdjacentPeriods([p('a', 7, 8), p('b', 11, 14)])

    expect(merged).toHaveLength(2)
    expect(merged[0].ends_at).toBe(at(8))
    expect(merged[1].starts_at).toBe(at(11))
  })

  it('never merges across authors', () => {
    // Who said it is part of what the line means, so an admin's note and the
    // official's own must stay separate even when they touch.
    const merged = mergeAdjacentPeriods([
      p('a', 7, 8, { created_by_role: 'tenant_admin' }),
      p('b', 8, 9, { created_by_role: 'official' }),
    ])

    expect(merged).toHaveLength(2)
  })

  it('never merges across differing reasons', () => {
    const merged = mergeAdjacentPeriods([
      p('a', 7, 8, { reason: 'Working' }),
      p('b', 8, 9, { reason: 'Away' }),
    ])

    expect(merged).toHaveLength(2)
  })

  it('absorbs a period contained within another', () => {
    const merged = mergeAdjacentPeriods([p('a', 7, 14), p('b', 9, 10)])

    expect(merged).toHaveLength(1)
    expect(merged[0].ends_at).toBe(at(14))
  })

  it('sorts before merging, so input order does not matter', () => {
    const merged = mergeAdjacentPeriods([p('c', 9, 10), p('a', 7, 8), p('b', 8, 9)])

    expect(merged).toHaveLength(1)
    expect(merged[0].starts_at).toBe(at(7))
  })

  it('leaves the input array untouched', () => {
    const input = [p('a', 7, 8), p('b', 8, 9)]
    mergeAdjacentPeriods(input)

    expect(input).toHaveLength(2)
    expect(input[0].ends_at).toBe(at(8))
  })
})

describe('clashingAuthor', () => {
  it('is null when the shift sits outside every period', () => {
    expect(clashingAuthor(at(13), at(14), [period()])).toBeNull()
  })

  it('is null when the shift only touches a period end', () => {
    // Half-open, like every other boundary in this file: a shift starting the
    // minute an absence ends is not a clash, and warning about it would train
    // officials to ignore the chip.
    expect(clashingAuthor(at(12), at(13), [period()])).toBeNull()
  })

  it('names the official when their own declaration overlaps', () => {
    expect(clashingAuthor(at(11), at(13), [period({ created_by_role: 'official' })])).toBe(
      'official'
    )
  })

  it('names the organisers when they recorded it', () => {
    expect(clashingAuthor(at(8), at(10), [period({ created_by_role: 'tenant_admin' })])).toBe(
      'tenant_admin'
    )
  })

  it('prefers the organisers when both kinds overlap the same shift', () => {
    const periods = [
      period({ id: 'own', created_by_role: 'official' }),
      period({ id: 'set', created_by_role: 'tenant_admin', starts_at: at(10), ends_at: at(14) }),
    ]
    expect(clashingAuthor(at(11), at(12), periods)).toBe('tenant_admin')
  })

  it('ignores a non-overlapping period of the other kind', () => {
    // The tie-break must not reach past the overlap test: an admin period
    // elsewhere in the day cannot relabel a clash with the official's own.
    const periods = [
      period({ id: 'own', created_by_role: 'official' }),
      period({ id: 'set', created_by_role: 'tenant_admin', starts_at: at(18), ends_at: at(20) }),
    ]
    expect(clashingAuthor(at(10), at(11), periods)).toBe('official')
  })

  it('is null with no periods at all', () => {
    expect(clashingAuthor(at(9), at(10), [])).toBeNull()
  })
})

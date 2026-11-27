import { describe, it, expect } from 'vitest'
import { formatTaskWhen, isOverdue, isoToWallClock, wallClockToIso } from './_utils'

describe('wall-clock conversion', () => {
  it('stores the typed time as UTC and reads it back unchanged', () => {
    expect(wallClockToIso('2026-12-01T10:00')).toBe('2026-12-01T10:00:00.000Z')
    expect(isoToWallClock('2026-12-01T10:00:00+00:00')).toBe('2026-12-01T10:00')
    expect(isoToWallClock(null)).toBeNull()
  })
})

describe('formatTaskWhen', () => {
  it('shows the deadline alone', () => {
    expect(formatTaskWhen({ starts_at: null, deadline: '2026-12-01T10:00:00Z' }, 'en')).toMatch(
      /1 Dec · 10:00$/
    )
  })

  it('shows start–deadline on one day as one date and two times', () => {
    expect(
      formatTaskWhen({ starts_at: '2026-12-01T08:00:00Z', deadline: '2026-12-01T10:00:00Z' }, 'en')
    ).toMatch(/1 Dec · 08:00–10:00$/)
  })

  it('shows both dates when start and deadline are on different days', () => {
    const text = formatTaskWhen(
      { starts_at: '2026-11-30T08:00:00Z', deadline: '2026-12-01T10:00:00Z' },
      'en'
    )
    expect(text).toMatch(/30 Nov · 08:00 – .*1 Dec · 10:00$/)
  })
})

describe('isOverdue', () => {
  const now = new Date('2026-12-01T12:00:00Z')

  it('is overdue past the deadline when not done', () => {
    expect(isOverdue({ done: false, deadline: '2026-12-01T10:00:00Z' }, now)).toBe(true)
  })

  it('is never overdue when done, or before the deadline', () => {
    expect(isOverdue({ done: true, deadline: '2026-12-01T10:00:00Z' }, now)).toBe(false)
    expect(isOverdue({ done: false, deadline: '2026-12-01T13:00:00Z' }, now)).toBe(false)
  })
})

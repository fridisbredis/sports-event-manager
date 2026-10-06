import { describe, it, expect } from 'vitest'
import { relativeTime } from './relative-time'

// `now` is passed in and every input is derived from it, so these never go
// stale the way a hardcoded date would.
const now = new Date('2026-10-06T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('relativeTime', () => {
  it('formats hours in English', () => {
    expect(relativeTime(ago(2 * HOUR), 'en', now)).toBe('2 hours ago')
  })

  it('formats hours in Swedish', () => {
    expect(relativeTime(ago(2 * HOUR), 'sv', now)).toContain('2')
  })

  it('picks minutes for a recent run', () => {
    expect(relativeTime(ago(5 * MINUTE), 'en', now)).toBe('5 minutes ago')
  })

  it("says 'yesterday' rather than '1 day ago'", () => {
    expect(relativeTime(ago(DAY), 'en', now)).toBe('yesterday')
  })

  it('scales up to days for an older run', () => {
    expect(relativeTime(ago(3 * DAY), 'en', now)).toBe('3 days ago')
  })

  it('returns null for an empty timestamp so the caller can omit the time', () => {
    expect(relativeTime('', 'en', now)).toBeNull()
  })

  it('returns null for an unparseable timestamp rather than rendering NaN', () => {
    expect(relativeTime('not-a-date', 'en', now)).toBeNull()
  })
})

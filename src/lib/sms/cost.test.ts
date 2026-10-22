import { describe, it, expect, afterEach, vi } from 'vitest'
import { totalUsage, costPerSegment, isUsingFallbackRate, startOfMonthUtc } from './cost'
import { parseSegments, parsePrice } from './usage'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseSegments', () => {
  it("reads Twilio's string segment count", () => {
    expect(parseSegments('2')).toBe(2)
  })

  // Undercounting spend is the more dangerous error for a table that will
  // eventually back a cap, so anything unreadable counts as one segment.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['not a number', 'two'],
    ['zero', '0'],
    ['negative', '-1'],
  ])('falls back to one segment for %s', (_label, value) => {
    expect(parseSegments(value as string | null | undefined)).toBe(1)
  })

  it('floors a fractional count rather than carrying it into the total', () => {
    expect(parseSegments('2.9')).toBe(2)
  })
})

describe('parsePrice', () => {
  it('parses the negative string Twilio returns', () => {
    expect(parsePrice('-0.0685')).toBe(-0.0685)
  })

  // price is null on nearly every create() response — Twilio sets it on
  // delivery, not on accept. Nothing derives SEK from it.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['unparseable', 'free'],
  ])('returns null for %s', (_label, value) => {
    expect(parsePrice(value as string | null | undefined)).toBeNull()
  })
})

describe('costPerSegment', () => {
  it('uses a configured rate when one is set', () => {
    vi.stubEnv('SMS_COST_PER_SEGMENT', '0.42')

    expect(costPerSegment()).toBe(0.42)
    expect(isUsingFallbackRate()).toBe(false)
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not a number', 'cheap'],
    ['zero', '0'],
    ['negative', '-1'],
  ])('falls back and says so when the rate is %s', (_label, value) => {
    vi.stubEnv('SMS_COST_PER_SEGMENT', value as string)

    expect(costPerSegment()).toBeGreaterThan(0)
    expect(isUsingFallbackRate()).toBe(true)
  })
})

describe('totalUsage', () => {
  it('counts segments rather than messages', () => {
    // The distinction the whole module exists for: two 2-segment invites cost
    // the same as four single-segment announcements.
    vi.stubEnv('SMS_COST_PER_SEGMENT', '1')

    const totals = totalUsage([
      { segments: 2, status: 'sent' },
      { segments: 2, status: 'sent' },
    ])

    expect(totals.sent).toBe(2)
    expect(totals.segments).toBe(4)
    expect(totals.amount).toBe(4)
  })

  it('counts failed sends but charges nothing for them', () => {
    vi.stubEnv('SMS_COST_PER_SEGMENT', '1')

    const totals = totalUsage([
      { segments: 1, status: 'sent' },
      { segments: 1, status: 'failed' },
      { segments: 3, status: 'failed' },
    ])

    expect(totals.sent).toBe(1)
    expect(totals.failed).toBe(2)
    // Twilio does not charge for a message it refused, so the failed rows'
    // segments must not reach the total.
    expect(totals.segments).toBe(1)
    expect(totals.amount).toBe(1)
  })

  it('returns zeroes for no usage', () => {
    expect(totalUsage([])).toEqual({ sent: 0, failed: 0, segments: 0, amount: 0 })
  })

  it('rounds once at the end, not per row', () => {
    // 3 × 0.333 = 0.999 → 1.00. Rounding each row to öre first would give
    // 3 × 0.33 = 0.99, and the error grows with volume.
    vi.stubEnv('SMS_COST_PER_SEGMENT', '0.333')

    const totals = totalUsage([
      { segments: 1, status: 'sent' },
      { segments: 1, status: 'sent' },
      { segments: 1, status: 'sent' },
    ])

    expect(totals.amount).toBe(1)
  })

  it('stays exact over a realistic announcement volume', () => {
    // 500 recipients — the per-announcement cap — at 2 segments each.
    vi.stubEnv('SMS_COST_PER_SEGMENT', '0.75')

    const totals = totalUsage(Array.from({ length: 500 }, () => ({ segments: 2, status: 'sent' })))

    expect(totals.segments).toBe(1000)
    expect(totals.amount).toBe(750)
  })
})

describe('startOfMonthUtc', () => {
  it('returns the first instant of the given month', () => {
    expect(startOfMonthUtc(new Date('2026-10-19T14:30:00.000Z'))).toBe('2026-10-01T00:00:00.000Z')
  })

  it('does not roll back a month on the first of the month', () => {
    expect(startOfMonthUtc(new Date('2026-10-01T00:00:00.000Z'))).toBe('2026-10-01T00:00:00.000Z')
  })

  it('handles a January date without rolling the year', () => {
    expect(startOfMonthUtc(new Date('2026-01-15T12:00:00.000Z'))).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('SMS_COST_PER_SEGMENT rename', () => {
  it('still honours the old SMS_SEK_PER_SEGMENT name', () => {
    // An environment that has only the old name set must not silently drop to
    // the built-in rate on the deploy that renames it — that would move every
    // tenant's cap without anyone touching a figure.
    vi.stubEnv('SMS_COST_PER_SEGMENT', '')
    vi.stubEnv('SMS_SEK_PER_SEGMENT', '0.42')

    expect(costPerSegment()).toBe(0.42)
    expect(isUsingFallbackRate()).toBe(false)
  })

  it('prefers the new name when both are set', () => {
    vi.stubEnv('SMS_COST_PER_SEGMENT', '0.9')
    vi.stubEnv('SMS_SEK_PER_SEGMENT', '0.42')

    expect(costPerSegment()).toBe(0.9)
  })
})

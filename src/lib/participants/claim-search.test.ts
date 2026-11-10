import { describe, it, expect } from 'vitest'
import { matchesClaimSearch, type ClaimListRow } from './claim-search'

const row = (bib: string | null, name: string | null): ClaimListRow => ({
  id: 'p',
  bib,
  name,
  claimed: false,
})

describe('matchesClaimSearch (CLAIM-01, L10)', () => {
  it('matches everything on an empty or blank query', () => {
    expect(matchesClaimSearch(row('101', 'Lisa Nord'), '')).toBe(true)
    expect(matchesClaimSearch(row('101', 'Lisa Nord'), '   ')).toBe(true)
  })

  it('matches a bib from its start only', () => {
    expect(matchesClaimSearch(row('101', 'Lisa Nord'), '10')).toBe(true)
    expect(matchesClaimSearch(row('210', 'Lisa Nord'), '10')).toBe(false)
  })

  it('matches the start of any word in the name, case-insensitively', () => {
    expect(matchesClaimSearch(row('104', 'Oskar Berg'), 'berg')).toBe(true)
    expect(matchesClaimSearch(row('104', 'Oskar Berg'), 'OSK')).toBe(true)
    expect(matchesClaimSearch(row('104', 'Anna-Karin Ek'), 'karin')).toBe(true)
    expect(matchesClaimSearch(row('104', 'Ekberg'), 'berg')).toBe(false)
  })

  it('handles Swedish letters', () => {
    expect(matchesClaimSearch(row('102', 'Karl Ström'), 'STRÖ')).toBe(true)
    expect(matchesClaimSearch(row('103', 'Emma Sjö'), 'sjö')).toBe(true)
  })

  it('copes with a row missing bib or name', () => {
    expect(matchesClaimSearch(row(null, 'Lisa Nord'), 'lisa')).toBe(true)
    expect(matchesClaimSearch(row('101', null), '101')).toBe(true)
    expect(matchesClaimSearch(row('101', null), 'lisa')).toBe(false)
  })
})

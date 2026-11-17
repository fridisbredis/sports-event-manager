import { afterEach, describe, expect, it, vi } from 'vitest'
import { offersTournaments, tournamentAppUrl } from './app-url'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('tournamentAppUrl', () => {
  it('is the origin, without a path or trailing slash', () => {
    vi.stubEnv('TOURNAMENT_APP_URL', 'https://tournaments.test/')
    expect(tournamentAppUrl()).toBe('https://tournaments.test')
  })

  it.each(['', '   ', 'not a url', 'javascript:alert(1)'])('is off for %j', (value) => {
    vi.stubEnv('TOURNAMENT_APP_URL', value)
    expect(tournamentAppUrl()).toBeNull()
  })
})

describe('offersTournaments', () => {
  const official = { tier: 'premium', officialId: 'off-1' }

  it('is on for an official on a premium tenant with the app configured', () => {
    vi.stubEnv('TOURNAMENT_APP_URL', 'https://tournaments.test')
    expect(offersTournaments(official)).toBe(true)
    expect(offersTournaments({ ...official, tier: 'professional' })).toBe(true)
  })

  it('is off on standard', () => {
    vi.stubEnv('TOURNAMENT_APP_URL', 'https://tournaments.test')
    expect(offersTournaments({ ...official, tier: 'standard' })).toBe(false)
  })

  // ADR-0005 §5.3: an admin without a roster row gets no token, so no tab.
  it('is off without a roster row', () => {
    vi.stubEnv('TOURNAMENT_APP_URL', 'https://tournaments.test')
    expect(offersTournaments({ ...official, officialId: null })).toBe(false)
  })

  it('is off when the app is not configured', () => {
    vi.stubEnv('TOURNAMENT_APP_URL', '')
    expect(offersTournaments(official)).toBe(false)
  })
})

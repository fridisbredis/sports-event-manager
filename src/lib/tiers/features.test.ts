import { describe, it, expect } from 'vitest'
import {
  TIER_ORDER,
  TIER_FEATURES,
  hasFeature,
  isTier,
  tiersWithFeature,
  featuresForTier,
  monthlySmsCap,
  maxActiveEvents,
} from './features'

describe('hasFeature', () => {
  it('denies a feature on a tier below its minimum', () => {
    expect(hasFeature('standard', 'colorTheme')).toBe(false)
  })

  it('allows a feature on exactly its minimum tier', () => {
    expect(hasFeature('premium', 'colorTheme')).toBe(true)
  })

  // The gate is cumulative: "available from Premium and up". A tier above the
  // minimum must not lose the feature, which an equality check would do.
  it('allows a feature on a tier above its minimum', () => {
    expect(hasFeature('professional', 'colorTheme')).toBe(true)
  })

  // A value predating a rename, or a hand-edited row, must not be read as the
  // lowest tier — that would silently grant whatever the lowest tier includes.
  it('denies every feature for an unrecognised tier', () => {
    expect(hasFeature('enterprise', 'colorTheme')).toBe(false)
    expect(hasFeature('', 'colorTheme')).toBe(false)
    expect(hasFeature('PREMIUM', 'colorTheme')).toBe(false)
  })
})

describe('participants (N21 / PART-01)', () => {
  // The card is explicit: "Tier: Premium and Professional. No participants
  // in Standard." Asserted by name rather than left to the generic cases
  // above, because this gate decides whether a tenant's participant roster
  // and its Race Results import exist at all — and because the import
  // MUTATES, so the same gate has to hold on the server action, not only
  // on the page.
  it('is locked on standard', () => {
    expect(hasFeature('standard', 'participants')).toBe(false)
  })

  it('is unlocked on premium and professional', () => {
    expect(hasFeature('premium', 'participants')).toBe(true)
    expect(hasFeature('professional', 'participants')).toBe(true)
  })

  it('lists exactly the tiers the card names', () => {
    expect(tiersWithFeature('participants')).toEqual(['premium', 'professional'])
  })
})

describe('TIER_ORDER', () => {
  // The ordering is the thing the gate reasons over, not an incidental
  // detail of the array: reordering it silently changes who gets what.
  it('runs from least to most capable', () => {
    expect(TIER_ORDER).toEqual(['standard', 'premium', 'professional'])
  })

  it('names a tier that exists for every feature minimum', () => {
    for (const minimum of Object.values(TIER_FEATURES)) {
      expect(TIER_ORDER).toContain(minimum)
    }
  })
})

describe('isTier', () => {
  it('accepts every declared tier', () => {
    for (const tier of TIER_ORDER) {
      expect(isTier(tier)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isTier('enterprise')).toBe(false)
  })
})

describe('tiersWithFeature', () => {
  it('lists the unlocking tiers lowest first', () => {
    expect(tiersWithFeature('colorTheme')).toEqual(['premium', 'professional'])
  })
})

describe('featuresForTier', () => {
  it('omits features the tier does not reach', () => {
    expect(featuresForTier('standard')).toEqual([])
  })

  it('includes features at or below the tier', () => {
    expect(featuresForTier('premium')).toContain('colorTheme')
    expect(featuresForTier('professional')).toContain('colorTheme')
  })
})

describe('monthlySmsCap', () => {
  it('returns the cap for each tier', () => {
    expect(monthlySmsCap('standard')).toBe(100)
    expect(monthlySmsCap('premium')).toBe(200)
    expect(monthlySmsCap('professional')).toBe(300)
  })

  it('gives an unrecognised tier the lowest cap, never an unlimited one', () => {
    // Fails closed the same way maxTenantAdmins does: a renamed or
    // hand-edited tier value restricts spending rather than removing the
    // limit. Returning Infinity here would make a typo in the tiers table
    // silently uncap a tenant.
    expect(monthlySmsCap('enterprise')).toBe(100)
    expect(monthlySmsCap('')).toBe(100)
  })
})

describe('maxActiveEvents', () => {
  it('returns the cap for each tier', () => {
    expect(maxActiveEvents('standard')).toBe(1)
    expect(maxActiveEvents('premium')).toBe(5)
    expect(maxActiveEvents('professional')).toBe(20)
  })

  it('gives an unrecognised tier the lowest cap, never an unlimited one', () => {
    expect(maxActiveEvents('enterprise')).toBe(1)
    expect(maxActiveEvents('')).toBe(1)
  })
})

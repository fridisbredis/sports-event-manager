import { describe, it, expect } from 'vitest'
import { isParticipantSideOpen, canPublish, displayedEventStatus } from './participant-side'

describe('isParticipantSideOpen (N36)', () => {
  it.each([
    ['published', 'premium', true],
    ['published', 'professional', true],
    // PB5: Standard cannot open the participant side, even with a row stored
    // as published from before a downgrade.
    ['published', 'standard', false],
    ['draft', 'premium', false],
    ['draft', 'professional', false],
    ['archived', 'professional', false],
    // An unknown tier fails closed, as hasFeature does.
    ['published', 'enterprise', false],
  ])('status %s on %s -> %s', (status, tier, open) => {
    expect(isParticipantSideOpen({ status }, tier)).toBe(open)
  })
})

describe('canPublish (PB5)', () => {
  it('is Premium and up', () => {
    expect(canPublish('standard')).toBe(false)
    expect(canPublish('premium')).toBe(true)
    expect(canPublish('professional')).toBe(true)
  })
})

describe('displayedEventStatus (PB11)', () => {
  it('shows a Standard event as Draft whatever is stored', () => {
    expect(displayedEventStatus('published', 'standard')).toBe('draft')
    expect(displayedEventStatus('draft', 'standard')).toBe('draft')
  })

  it('leaves archived alone on every tier', () => {
    expect(displayedEventStatus('archived', 'standard')).toBe('archived')
    expect(displayedEventStatus('archived', 'premium')).toBe('archived')
  })

  it('shows the stored status where publishing is in the plan', () => {
    expect(displayedEventStatus('published', 'premium')).toBe('published')
    expect(displayedEventStatus('draft', 'professional')).toBe('draft')
  })
})

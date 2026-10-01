import { describe, it, expect } from 'vitest'
import { toSlug } from './_utils'

describe('toSlug', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(toSlug('Sundsvall Orientering')).toBe('sundsvall-orientering')
  })

  it('collapses runs of whitespace into a single hyphen', () => {
    expect(toSlug('  Gävle   SK  ')).toBe('gavle-sk')
  })

  it('spells out Swedish letters instead of dropping them', () => {
    // The bug this guards: stripping non-[a-z0-9-] turned "Växjö" into "vxj".
    expect(toSlug('Växjö')).toBe('vaxjo')
    expect(toSlug('Åre Skidklubb')).toBe('are-skidklubb')
    expect(toSlug('Malmö IF')).toBe('malmo-if')
    expect(toSlug('Örebro')).toBe('orebro')
  })

  it('carries the Danish and Norwegian letters too', () => {
    expect(toSlug('Tromsø IL')).toBe('tromso-il')
    expect(toSlug('Ærø')).toBe('aero')
  })

  it('strips diacritics from other accented letters', () => {
    expect(toSlug('Café Sport')).toBe('cafe-sport')
    expect(toSlug('Münchens SK')).toBe('munchens-sk')
  })

  it('drops characters that have no romanisation', () => {
    expect(toSlug('Klubb! (2026)')).toBe('klubb-2026')
  })

  it('keeps digits', () => {
    expect(toSlug('IK 1904')).toBe('ik-1904')
  })
})

import { describe, it, expect } from 'vitest'
import {
  normalizeIcePhone,
  normalizeIceContact,
  isIceContactEmpty,
  iceContactInputSchema,
} from './ice-contact'

describe('normalizeIcePhone', () => {
  it('reads a national number as Swedish', () => {
    expect(normalizeIcePhone('070-123 45 67')).toBe('46701234567')
  })

  it('reads a +-prefixed number as international, any country', () => {
    expect(normalizeIcePhone('+46 70 123 45 67')).toBe('46701234567')
    // GB is outside the invite picker (Twilio cannot SMS it) but an ICE
    // contact is called, never texted.
    expect(normalizeIcePhone('+44 7911 123456')).toBe('447911123456')
  })

  it('reads a 00-prefixed number as international', () => {
    expect(normalizeIcePhone('0047 412 34 567')).toBe('4741234567')
  })

  it('returns null for empty and invalid input', () => {
    expect(normalizeIcePhone('')).toBeNull()
    expect(normalizeIcePhone('   ')).toBeNull()
    expect(normalizeIcePhone('123')).toBeNull()
    expect(normalizeIcePhone('not a number')).toBeNull()
  })
})

describe('normalizeIceContact', () => {
  it('maps empty fields to null', () => {
    expect(normalizeIceContact({ phone: ' ', name: '', relation: '  ' })).toEqual({
      ok: true,
      contact: { phone: null, name: null, relation: null },
    })
  })

  it('trims and normalizes a partial contact', () => {
    expect(normalizeIceContact({ phone: '', name: ' Göran Berg ', relation: 'Partner' })).toEqual({
      ok: true,
      contact: { phone: null, name: 'Göran Berg', relation: 'Partner' },
    })
  })

  it('normalizes the phone of a full contact', () => {
    expect(
      normalizeIceContact({ phone: '070 123 45 67', name: 'Göran', relation: 'Spouse' })
    ).toEqual({
      ok: true,
      contact: { phone: '46701234567', name: 'Göran', relation: 'Spouse' },
    })
  })

  it('rejects an entered phone that does not parse instead of dropping it', () => {
    expect(normalizeIceContact({ phone: '12', name: 'Göran', relation: '' })).toEqual({
      ok: false,
      error: 'invalid_phone',
    })
  })
})

describe('isIceContactEmpty', () => {
  it('treats null, undefined and all-null as empty', () => {
    expect(isIceContactEmpty(null)).toBe(true)
    expect(isIceContactEmpty(undefined)).toBe(true)
    expect(isIceContactEmpty({ phone: null, name: null, relation: null })).toBe(true)
  })

  it('treats any one field as not empty', () => {
    expect(isIceContactEmpty({ phone: null, name: null, relation: 'Parent' })).toBe(false)
  })
})

describe('iceContactInputSchema', () => {
  it('enforces the database length limits', () => {
    expect(
      iceContactInputSchema.safeParse({ phone: '', name: '', relation: 'x'.repeat(101) }).success
    ).toBe(false)
    expect(
      iceContactInputSchema.safeParse({ phone: '', name: 'x'.repeat(200), relation: '' }).success
    ).toBe(true)
  })
})

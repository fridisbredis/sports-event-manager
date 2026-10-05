import { describe, it, expect } from 'vitest'
import { guessPhoneCountryFromLocale, DEFAULT_PHONE_COUNTRY } from './phone'

describe('guessPhoneCountryFromLocale', () => {
  it('resolves a region we offer in the picker', () => {
    expect(guessPhoneCountryFromLocale('sv-SE')).toBe('SE')
  })

  // navigator.language is not case-normalized across browsers, so the region
  // subtag can arrive lowercase ("nb-no") and must still match the lookup.
  it('uppercases the region subtag before the lookup', () => {
    expect(guessPhoneCountryFromLocale('nb-no')).toBe('NO')
  })

  it('falls back to the default when the tag carries no region', () => {
    expect(guessPhoneCountryFromLocale('sv')).toBe(DEFAULT_PHONE_COUNTRY)
  })

  // GB is deliberately absent from PHONE_COUNTRIES (Twilio 21612), so a British
  // browser must prefill the default rather than a country we cannot send to.
  it('falls back to the default for a region outside the picker', () => {
    expect(guessPhoneCountryFromLocale('en-GB')).toBe(DEFAULT_PHONE_COUNTRY)
  })

  it('falls back to the default when no locale is available', () => {
    expect(guessPhoneCountryFromLocale(undefined)).toBe(DEFAULT_PHONE_COUNTRY)
  })
})

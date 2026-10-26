import { describe, it, expect } from 'vitest'
import {
  guessPhoneCountryFromLocale,
  DEFAULT_PHONE_COUNTRY,
  formatEnteredPhoneForDisplay,
} from './phone'

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

describe('formatEnteredPhoneForDisplay', () => {
  it('formats a national number in the default country', () => {
    expect(formatEnteredPhoneForDisplay('070-123 45 67')).toBe('+46 70 123 45 67')
  })

  it('formats an international number as written', () => {
    expect(formatEnteredPhoneForDisplay('+47 412 34 567')).toBe('+47 41 23 45 67')
  })

  it('formats our stored E.164 form without its plus', () => {
    expect(formatEnteredPhoneForDisplay('46701234567')).toBe('+46 70 123 45 67')
  })

  // The case formatPhoneForDisplay gets wrong for free text: a leading '+'
  // added to a national number either fails or lands in another country.
  it('shows anything that is not a valid number exactly as entered', () => {
    expect(formatEnteredPhoneForDisplay('ring Kalle')).toBe('ring Kalle')
    expect(formatEnteredPhoneForDisplay('12345')).toBe('12345')
  })
})

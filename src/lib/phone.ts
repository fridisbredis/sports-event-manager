import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

// Countries offered in the invite form's country picker.
// GB is deliberately excluded: Twilio error 21612 ("From" number not permitted to
// send to that destination) blocks delivery from our Swedish sender, and fixing it
// requires UK sender registration with Twilio, not a code or Geo Permissions change.
export const PHONE_COUNTRIES = [
  { code: 'SE' as const, dialCode: '46', flag: '🇸🇪', label: '🇸🇪 SE (+46)' },
  { code: 'NO' as const, dialCode: '47', flag: '🇳🇴', label: '🇳🇴 NO (+47)' },
  { code: 'DK' as const, dialCode: '45', flag: '🇩🇰', label: '🇩🇰 DK (+45)' },
  { code: 'FI' as const, dialCode: '358', flag: '🇫🇮', label: '🇫🇮 FI (+358)' },
]

export const DEFAULT_PHONE_COUNTRY: CountryCode = 'SE'

// Supabase Auth stores user.phone as E.164 without the leading '+' (e.g. "46701234567").
// officials.phone is compared against that value with exact string equality by the
// SEC-04 confirm-invite RPCs (0017/0018), so any number accepted here must normalize
// to that same shape or the phone-match binding breaks.
export function normalizePhoneToE164(rawPhone: string, country: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(rawPhone, country)
  if (!parsed || !parsed.isValid()) return null
  return parsed.number.replace(/^\+/, '')
}

export function isValidPhoneForCountry(rawPhone: string, country: CountryCode): boolean {
  return normalizePhoneToE164(rawPhone, country) !== null
}

// Canonical form for rate-limit keys (see rate-limit.ts), which are plain strings with
// no normalization of their own — callers must agree on one shape or the same number
// keys two different rows. Stored phones can inconsistently carry a leading '+'; this
// always strips it, matching normalizePhoneToE164's output.
export function stripE164Plus(phone: string): string {
  return phone.startsWith('+') ? phone.slice(1) : phone
}

// Outbound SMS goes through our own Twilio client, which requires E.164 *with* the
// leading '+'. Stored values omit it (see normalizePhoneToE164) and legacy rows are
// inconsistent, so tolerate both on the way out. This is the only place the '+' is
// added back — never write this value to the DB or pass it to an SEC-04 RPC.
export function toTwilioE164(storedPhone: string): string {
  return storedPhone.startsWith('+') ? storedPhone : `+${storedPhone}`
}

// Numbers stored in officials.phone/user.phone are E.164 but inconsistently missing
// their leading '+' (Supabase test numbers keep it, our own normalization strips it).
// Display-only — never write this formatted value back to the DB or an SEC-04 RPC.
export function formatPhoneForDisplay(storedPhone: string): string {
  const withPlus = toTwilioE164(storedPhone)
  const parsed = parsePhoneNumberFromString(withPlus)
  return parsed ? parsed.formatInternational() : storedPhone
}

const LOCALE_REGION_TO_COUNTRY: Record<string, CountryCode> = {
  SE: 'SE',
  NO: 'NO',
  DK: 'DK',
  FI: 'FI',
}

// Best-effort guess from the browser's language tag (e.g. "sv-SE") — no geolocation
// permission prompt involved. Falls back to Sweden, the platform's home market.
export function guessPhoneCountryFromLocale(locale: string | undefined): CountryCode {
  const region = locale?.split('-')[1]?.toUpperCase()
  return (region && LOCALE_REGION_TO_COUNTRY[region]) || DEFAULT_PHONE_COUNTRY
}

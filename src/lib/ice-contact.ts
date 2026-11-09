import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { z } from 'zod'
import { DEFAULT_PHONE_COUNTRY } from '@/lib/phone'

/**
 * N37: one emergency (ICE) contact per user — phone, name and relation, every
 * field optional. Stored in public.user_ice_contacts (migration
 * 20261109141949), readable only by the user, tenant admins of a tenant the
 * user has a role in, and system admins.
 *
 * Shared by every place that writes one (ACCT-01, the invite form, later
 * CLAIM-02 in N40) so they agree on what a valid contact is and how it is
 * stored.
 */

/** What the form fields hold: plain strings, empty meaning "not given". */
export interface IceContactInput {
  phone: string
  name: string
  relation: string
}

/** What the database holds: null for a field that was not given. */
export interface IceContact {
  phone: string | null
  name: string | null
  relation: string | null
}

export const EMPTY_ICE_CONTACT_INPUT: IceContactInput = { phone: '', name: '', relation: '' }

// Mirrors the CHECK constraints in migration 20261109141949. The phone bound
// is on the raw input, which may carry spaces and dashes the stored form drops.
export const ICE_NAME_MAX = 200
export const ICE_RELATION_MAX = 100
const ICE_PHONE_INPUT_MAX = 32

export const iceContactInputSchema = z.object({
  phone: z.string().max(ICE_PHONE_INPUT_MAX),
  name: z.string().max(ICE_NAME_MAX),
  relation: z.string().max(ICE_RELATION_MAX),
})

/**
 * Parses a typed ICE phone number into the stored form: E.164 without the
 * leading '+', the same shape as officials.phone and auth.users.phone, so
 * formatPhoneForDisplay and toTwilioE164 work on it unchanged.
 *
 * Any country is accepted, unlike the invite form's picker. That list exists
 * because Twilio cannot SMS some destinations from our sender; nobody texts an
 * ICE contact, an admin calls them, and a runner's next of kin may well live
 * abroad. Without a country picker (the wireframes have none), the number is
 * read as international when it starts with '+' or '00', and as a national
 * number in the default country otherwise — "070-123 45 67" is Swedish.
 *
 * Returns null for anything that is not a valid number.
 */
export function normalizeIcePhone(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const international = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed
  const parsed = parsePhoneNumberFromString(international, DEFAULT_PHONE_COUNTRY)
  if (!parsed || !parsed.isValid()) return null
  return parsed.number.replace(/^\+/, '')
}

export type NormalizeIceContactResult =
  | { ok: true; contact: IceContact }
  | { ok: false; error: 'invalid_phone' }

/**
 * Turns form input into what is stored: trims every field, maps empty to null
 * and normalizes the phone. An entered phone that does not parse is an error
 * rather than silently dropped — the admin will dial whatever is stored.
 */
export function normalizeIceContact(input: IceContactInput): NormalizeIceContactResult {
  const phoneText = input.phone.trim()
  const phone = phoneText === '' ? null : normalizeIcePhone(phoneText)
  if (phoneText !== '' && phone === null) return { ok: false, error: 'invalid_phone' }

  const name = input.name.trim()
  const relation = input.relation.trim()

  return {
    ok: true,
    contact: {
      phone,
      name: name === '' ? null : name,
      relation: relation === '' ? null : relation,
    },
  }
}

export function isIceContactEmpty(contact: IceContact | null | undefined): boolean {
  return !contact || (contact.phone === null && contact.name === null && contact.relation === null)
}

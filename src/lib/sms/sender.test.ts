import { describe, it, expect } from 'vitest'
import { resolveSmsSender, smsSenderIdSchema } from './sender'

const PLATFORM = '+46700000000'

describe('resolveSmsSender', () => {
  it('uses the name on a Professional tenant that has one', () => {
    expect(resolveSmsSender({ tier: 'professional', sms_sender_id: 'Viadal' }, PLATFORM)).toBe(
      'Viadal'
    )
  })

  // The downgrade case: the name stays on the row but stops applying.
  it('uses the platform number on a lower tier even when a name is stored', () => {
    expect(resolveSmsSender({ tier: 'premium', sms_sender_id: 'Viadal' }, PLATFORM)).toBe(PLATFORM)
    expect(resolveSmsSender({ tier: 'standard', sms_sender_id: 'Viadal' }, PLATFORM)).toBe(PLATFORM)
  })

  it('uses the platform number on a Professional tenant with no name', () => {
    expect(resolveSmsSender({ tier: 'professional', sms_sender_id: null }, PLATFORM)).toBe(PLATFORM)
  })

  // A failed tenant read must still deliver the message.
  it('uses the platform number when the tenant is unknown', () => {
    expect(resolveSmsSender(null, PLATFORM)).toBe(PLATFORM)
    expect(resolveSmsSender(undefined, PLATFORM)).toBe(PLATFORM)
  })

  it('uses the platform number for an unrecognised tier', () => {
    expect(resolveSmsSender({ tier: 'enterprise', sms_sender_id: 'Viadal' }, PLATFORM)).toBe(
      PLATFORM
    )
  })
})

describe('smsSenderIdSchema', () => {
  it.each(['Viadal', 'Viadal 2026', 'A', 'abcdefghijk'])('accepts %j', (value) => {
    expect(smsSenderIdSchema.parse(value)).toBe(value)
  })

  it('trims surrounding spaces', () => {
    expect(smsSenderIdSchema.parse('  Viadal  ')).toBe('Viadal')
  })

  // Clearing the field means "back to the platform number".
  it('turns an empty or blank value into null', () => {
    expect(smsSenderIdSchema.parse('')).toBeNull()
    expect(smsSenderIdSchema.parse('   ')).toBeNull()
  })

  it.each([
    ['longer than 11 characters', 'abcdefghijkl'],
    ['digits only', '12345'],
    ['non-ASCII letters', 'Åre'],
    ['punctuation', 'Vi@dal'],
  ])('rejects %s', (_label, value) => {
    expect(smsSenderIdSchema.safeParse(value).success).toBe(false)
  })
})

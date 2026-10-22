import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  buildAvailabilityConfirmSms,
  shouldSendAvailabilityConfirmSms,
  buildAppLink,
} from './availability-confirm'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildAvailabilityConfirmSms', () => {
  it('includes the link so the message works as a bookmark', () => {
    const body = buildAvailabilityConfirmSms({
      name: 'Anna',
      tenant: 'Viadal',
      url: 'https://app.example.com/viadal/home',
    })

    expect(body).toContain('https://app.example.com/viadal/home')
  })

  it('names the tenant so the message is recognisable in a message list', () => {
    const body = buildAvailabilityConfirmSms({
      name: 'Anna',
      tenant: 'Viadal',
      url: 'https://app.example.com/viadal/home',
    })

    expect(body).toContain('Viadal')
  })

  it('says what the link is for, so it reads as a bookmark rather than a receipt', () => {
    const body = buildAvailabilityConfirmSms({
      name: 'Anna',
      tenant: 'Viadal',
      url: 'https://app.example.com/viadal/home',
    })

    expect(body.toLowerCase()).toContain('confirmed')
  })

  // The phone-fallback flow has no name to pass: the RPC returns only
  // tenant_id and role_granted, and that path never collected one.
  it('still produces a usable message when no name is known', () => {
    const body = buildAvailabilityConfirmSms({
      tenant: 'Viadal',
      url: 'https://app.example.com/viadal/home',
    })

    expect(body).toContain('https://app.example.com/viadal/home')
    expect(body).toContain('Viadal')
    expect(body).not.toContain('undefined')
  })

  it('starts with a capital letter when the greeting is dropped', () => {
    const body = buildAvailabilityConfirmSms({
      tenant: 'Viadal',
      url: 'https://app.example.com/viadal/home',
    })

    expect(body[0]).toBe(body[0].toUpperCase())
  })
})

describe('shouldSendAvailabilityConfirmSms', () => {
  // The flag's own wording in the UI covers "non-urgent SMS updates", and a
  // bookmark link is exactly that — unlike the invite paths, which do not
  // check the flag because an invitee has no row to opt out from yet.
  it('does not send when the official has opted out of SMS', () => {
    expect(shouldSendAvailabilityConfirmSms({ smsOptOut: true })).toBe(false)
  })

  it('sends when the official has not opted out', () => {
    expect(shouldSendAvailabilityConfirmSms({ smsOptOut: false })).toBe(true)
  })
})

describe('buildAppLink', () => {
  it('builds a link to the tenant home from the configured base URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')

    expect(buildAppLink('viadal')).toBe('https://app.example.com/viadal/home')
  })

  it('does not double the slash when the base URL has a trailing one', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/')

    expect(buildAppLink('viadal')).toBe('https://app.example.com/viadal/home')
  })

  // The whole point of this card is a link the official can tap later. A
  // misconfigured origin would otherwise send "undefined/viadal/home" — an
  // SMS that has already cost money and can never work. Returning null lets
  // the caller skip the send instead.
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not absolute', '/app'],
    ['not https', 'http://app.example.com'],
  ])('returns null when the base URL is %s', (_label, value) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value as string)

    expect(buildAppLink('viadal')).toBeNull()
  })
})

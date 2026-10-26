import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  buildAvailabilityConfirmSms,
  shouldSendAvailabilityConfirmSms,
  buildTenantHomeLink,
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

describe('buildTenantHomeLink', () => {
  it('points at the tenant home, which is the page this SMS bookmarks', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')

    expect(buildTenantHomeLink('viadal')).toBe('https://app.example.com/viadal/home')
  })

  // The origin rules themselves are buildAppLink's and are tested there
  // (app-link.test.ts). What matters here is that this path keeps honouring
  // them rather than growing its own interpolation.
  it('returns null when the origin cannot produce a working link', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')

    expect(buildTenantHomeLink('viadal')).toBeNull()
  })
})

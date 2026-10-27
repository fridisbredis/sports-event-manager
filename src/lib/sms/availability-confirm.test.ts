import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import twilio from 'twilio'
import {
  buildAvailabilityConfirmSms,
  shouldSendAvailabilityConfirmSms,
  buildTenantHomeLink,
  sendAvailabilityConfirmSms,
} from './availability-confirm'

const messagesCreate = vi.fn()
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))

vi.mock('./usage', () => ({
  recordSmsUsage: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

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

// N13: the confirmation goes out from the tenant's own sender.
describe('sendAvailabilityConfirmSms — N13 sender', () => {
  // Without this, a call from an earlier case would satisfy a later
  // toHaveBeenCalledWith.
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function chain(result: unknown) {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq']) builder[method] = vi.fn(() => builder)
    builder.maybeSingle = vi.fn(() => Promise.resolve(result))
    return builder
  }

  function serviceWith(tenant: { data?: unknown; error?: unknown }) {
    return {
      from: vi.fn((table: string) =>
        table === 'tenants'
          ? chain({ data: tenant.data ?? null, error: tenant.error ?? null })
          : chain({ data: { sms_opt_out: false }, error: null })
      ),
    }
  }

  async function send(service: ReturnType<typeof serviceWith>) {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    vi.stubEnv('TWILIO_PHONE_NUMBER', '+15550001111')
    messagesCreate.mockResolvedValue({})
    vi.mocked(twilio).mockReturnValue({ messages: { create: messagesCreate } } as never)

    await sendAvailabilityConfirmSms({
      service: service as never,
      tenantId: 't1',
      tenantSlug: 'viadal',
      phone: '46701111111',
      name: 'Anna',
      op: 'test',
    })
  }

  it.each([
    ['its name on Professional', 'professional', 'Viadal'],
    ['the platform number on Premium', 'premium', '+15550001111'],
  ])('sends from %s', async (_label, tier, expectedFrom) => {
    await send(serviceWith({ data: { tier, sms_sender_id: 'Viadal' } }))

    expect(messagesCreate).toHaveBeenCalledWith(expect.objectContaining({ from: expectedFrom }))
  })

  it('still sends, from the platform number, when the tenant cannot be read', async () => {
    await send(serviceWith({ error: { message: 'tenants unreadable' } }))

    expect(messagesCreate).toHaveBeenCalledWith(expect.objectContaining({ from: '+15550001111' }))
  })
})

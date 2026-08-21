import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkInviteRateLimit, releaseInviteRateLimit } from '@/lib/rate-limit'
import twilio from 'twilio'

vi.mock('@/lib/auth/tenant', () => ({
  requireTenantAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkInviteRateLimit: vi.fn(),
  releaseInviteRateLimit: vi.fn(),
}))

const messagesCreate = vi.fn()
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  return builder
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/officials/off-1/resend', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

// Registered by the tests that stub console.error, and always undone in afterEach: an
// assertion that fails mid-test must not leave console stubbed for every test after it.
let restoreConsoleError: (() => void) | undefined

describe('POST /api/officials/[id]/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    process.env.TWILIO_ACCOUNT_SID = 'AC_test'
    process.env.TWILIO_AUTH_TOKEN = 'token_test'
    process.env.TWILIO_PHONE_NUMBER = '+15550001111'
    vi.mocked(checkInviteRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    vi.mocked(releaseInviteRateLimit).mockResolvedValue(undefined)
  })

  afterEach(() => {
    restoreConsoleError?.()
    restoreConsoleError = undefined
  })

  it('returns 400 for invalid input without checking auth or sending sms', async () => {
    const res = await POST(makeRequest({ tenantId: 'not-a-uuid' }), makeParams('off-1'))

    expect(res.status).toBe(400)
    expect(requireTenantAdmin).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('returns the tenant admin auth error without touching the db or sms', async () => {
    const errorResponse = { status: 403 }
    vi.mocked(requireTenantAdmin).mockResolvedValue({ error: errorResponse } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res).toBe(errorResponse)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('validates tenantId via requireTenantAdmin and scopes the official lookup to that tenant', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const officialsBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsBuilder)
      .mockReturnValueOnce(chain({ data: { invite_token: 'tok-new' } }))
      .mockReturnValueOnce(chain({ data: { name: 'Viadal 2026' } }))
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(requireTenantAdmin).toHaveBeenCalledWith(TENANT_ID)
    expect(officialsBuilder.eq).toHaveBeenCalledWith('id', 'off-1')
    expect(officialsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('returns 404 when the official is not found', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res.status).toBe(404)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('returns 400 and does not send sms when the official is not in the invited state', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const fromMock = vi.fn().mockReturnValueOnce(
      chain({
        data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'confirmed' },
      })
    )
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res.status).toBe(400)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('regenerates the invite token and resends the confirmation text via Twilio', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)

    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
      .mockReturnValueOnce(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })

    // A fresh token, not the existing one: resend has to revoke the previous link rather
    // than grant it another expiry window, since it is the only rotation an admin has.
    expect(officialsUpdateBuilder.update).toHaveBeenCalledWith({
      invite_token: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      ),
      invite_token_expires_at: expect.any(String),
    })
    expect(officialsUpdateBuilder.eq).toHaveBeenCalledWith('id', 'off-1')
    expect(officialsUpdateBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Hi Anna, you have been invited as an official for Viadal 2026. Confirm your availability here: https://app.example.com/invite/tok-new',
      from: '+15550001111',
      to: '+46701234567',
    })
  })

  it('returns 500 and never sends sms when the token refresh fails', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(
        chain({
          data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
        })
      )
      .mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res.status).toBe(500)
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(releaseInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567')
  })

  it('releases the invite rate limit with a canonicalized phone (no leading +) when the token refresh fails', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(
        chain({
          data: { id: 'off-1', name: 'Anna', phone: '+46701234567', invite_status: 'invited' },
        })
      )
      .mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res.status).toBe(500)
    expect(checkInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567', 'admin-1')
    expect(releaseInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567')
  })

  it('returns 502 when the Twilio send rejects, after the token has already been refreshed', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)

    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
      .mockReturnValueOnce(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    messagesCreate.mockRejectedValueOnce(new Error('send failed'))

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body).toEqual({ error: 'Failed to send invite SMS' })
    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(officialsUpdateBuilder.update).toHaveBeenCalledTimes(1)
  })

  it('never logs the raw Twilio error or the recipient phone number', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)

    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
      .mockReturnValueOnce(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    const twilioError = Object.assign(new Error('Invalid To number: +46701234567'), {
      code: 21211,
    })
    messagesCreate.mockRejectedValueOnce(twilioError)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res.status).toBe(502)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const loggedMessage = consoleErrorSpy.mock.calls[0][0] as string
    expect(loggedMessage).toContain('off-1')
    expect(loggedMessage).toContain('21211')
    expect(loggedMessage).not.toContain('46701234567')

    consoleErrorSpy.mockRestore()
  })

  // A non-AC TWILIO_ACCOUNT_SID is our own deployment being misconfigured, not Twilio
  // rejecting anything, so it must not borrow the send path's 502: that status reads as
  // transient and invites a retry, and every retry of this route rotates the invite token
  // again. 500 plus an untouched token is the honest answer.
  it('returns 500 and never rotates the invite token when twilio() throws synchronously', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)

    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
      .mockReturnValueOnce(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    vi.mocked(twilio).mockImplementationOnce(() => {
      throw new Error('accountSid must start with AC')
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    restoreConsoleError = () => consoleErrorSpy.mockRestore()

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'SMS is not configured' })
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(officialsUpdateBuilder.update).not.toHaveBeenCalled()
  })

  it('returns 500 and never rotates the invite token when TWILIO_PHONE_NUMBER is unset', async () => {
    delete process.env.TWILIO_PHONE_NUMBER

    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)

    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
      .mockReturnValueOnce(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    restoreConsoleError = () => consoleErrorSpy.mockRestore()

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'SMS is not configured' })
    expect(messagesCreate).not.toHaveBeenCalled()

    // The existing invite link is still valid: there is no point spending the official's
    // only working link on a send that was structurally impossible.
    expect(officialsUpdateBuilder.update).not.toHaveBeenCalled()
    expect(officialsUpdateBuilder.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ invite_token: expect.anything() })
    )
  })

  it('returns 429 with Retry-After when the invite rate limit is exceeded, without rotating the token', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const fromMock = vi.fn().mockReturnValueOnce(officialsSelectBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)
    vi.mocked(checkInviteRateLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 17 })

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('17')
    expect(body.error).toBe('Too many invite attempts')
    expect(messagesCreate).not.toHaveBeenCalled()
    // Only the officials select ran — the rate limit gate sits before token rotation.
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('returns 503 when the rate limit check throws', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const fromMock = vi.fn().mockReturnValueOnce(officialsSelectBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)
    vi.mocked(checkInviteRateLimit).mockRejectedValue(new Error('db down'))

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toBe('Rate limit check failed')
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('releases the invite rate limit when the resend Twilio send rejects', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)

    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
      .mockReturnValueOnce(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    messagesCreate.mockRejectedValueOnce(new Error('send failed'))

    await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(releaseInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567')
  })

  it('does not release the invite rate limit on the happy path', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)

    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
      .mockReturnValueOnce(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(releaseInviteRateLimit).not.toHaveBeenCalled()
  })
})

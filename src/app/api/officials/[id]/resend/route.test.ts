import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { checkInviteRateLimit, releaseInviteRateLimit } from '@/lib/rate-limit'
import twilio from 'twilio'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { recordSmsUsage } from '@/lib/sms/usage'

vi.mock('@/lib/auth/tenant', () => ({
  requireTenantAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  // N11 usage accounting writes with the service client, and N24's cap reads
  // sms_usage with it: that table is revoked from `authenticated`, so this
  // route needs one even though the rest of it is RLS-scoped.
  //
  // Answers the cap's query with no rows — a tenant that has sent nothing this
  // month, which is the default these tests assume. Returning a bare {} would
  // make every test exercise the cap's fail-open path instead, and the extra
  // error log that produces would be mistaken for the route's own.
  createSupabaseServiceClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({ gte: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  })),
}))

vi.mock('@/lib/sms/usage', () => ({
  recordSmsUsage: vi.fn(),
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
      .mockReturnValueOnce(chain({ data: { name: 'Viadal 2026', tier: 'professional' } }))
      .mockReturnValueOnce(chain({ data: { invite_token: 'tok-new' } }))
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
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026', tier: 'professional' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(tenantsBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
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
      body: 'Hi Anna, Viadal 2026 has invited you as an official. Confirm within 7 days: https://app.example.com/invite/tok-new',
      from: '+15550001111',
      to: '+46701234567',
    })
  })

  // N11: a resend costs the tenant money, so it has to reach the usage ledger.
  // An uncounted send path is invisible until the SEK total disagrees with the
  // Twilio invoice and nobody can say which route is missing.
  it('records the resend against the tenant, with the segment count Twilio reported', async () => {
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
      .mockReturnValueOnce(chain({ data: { name: 'Viadal 2026', tier: 'professional' } }))
      .mockReturnValueOnce(chain({ data: { invite_token: 'tok-new' } }))
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)
    messagesCreate.mockResolvedValueOnce({ sid: 'SM1', numSegments: '2' })

    await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(recordSmsUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        kind: 'invite_resend',
        status: 'sent',
        message: expect.objectContaining({ numSegments: '2' }),
      })
    )
  })

  it('records a failed resend, which the cap must see as an attempt', async () => {
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
      .mockReturnValueOnce(chain({ data: { name: 'Viadal 2026', tier: 'professional' } }))
      .mockReturnValueOnce(chain({ data: { invite_token: 'tok-new' } }))
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)
    messagesCreate.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 21211 }))

    await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(recordSmsUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        kind: 'invite_resend',
        status: 'failed',
        message: null,
      })
    )
  })

  // Mirrors the create route: N19 pinned the invite SMS to English rather than
  // following the admin who pressed resend. See the comment on the equivalent
  // test in ../../route.test.ts for why.
  it('resends the invite SMS in English even when the admin works in Swedish', async () => {
    // Overrides the global 'en' stub from vitest.setup.ts, so a regression that
    // reinstated getUserLanguage() here would produce Swedish and fail.
    vi.mocked(getUserLanguage).mockResolvedValueOnce('sv')
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
      .mockReturnValueOnce(chain({ data: { name: 'Viadal 2026', tier: 'professional' } }))
      .mockReturnValueOnce(chain({ data: { invite_token: 'tok-new' } }))
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res.status).toBe(200)
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Hi Anna, Viadal 2026 has invited you as an official. Confirm within 7 days: https://app.example.com/invite/tok-new',
      })
    )
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
      .mockReturnValueOnce(chain({ data: { name: 'Viadal 2026', tier: 'professional' } }))
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
      .mockReturnValueOnce(chain({ data: { name: 'Viadal 2026', tier: 'professional' } }))
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
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026', tier: 'professional' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(tenantsBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
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
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026', tier: 'professional' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(tenantsBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
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
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026', tier: 'professional' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(tenantsBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
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
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026', tier: 'professional' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(tenantsBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
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

  // B9: the invite link's origin, checked before the rotation for the same
  // reason the two Twilio faults above are.
  it.each([
    ['unset', undefined],
    ['not https', 'http://app.example.com'],
  ])(
    'returns 500 and never rotates the invite token when NEXT_PUBLIC_APP_URL is %s',
    async (_label, value) => {
      if (value === undefined) delete process.env.NEXT_PUBLIC_APP_URL
      else process.env.NEXT_PUBLIC_APP_URL = value

      vi.mocked(requireTenantAdmin).mockResolvedValue({
        user: { id: 'admin-1' },
        role: 'tenant_admin',
      } as never)

      const officialsSelectBuilder = chain({
        data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
      })
      const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
      const tenantsBuilder = chain({ data: { name: 'Viadal 2026', tier: 'professional' } })
      const fromMock = vi.fn()
      fromMock
        .mockReturnValueOnce(officialsSelectBuilder)
        .mockReturnValueOnce(tenantsBuilder)
        .mockReturnValueOnce(officialsUpdateBuilder)
      vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      restoreConsoleError = () => consoleErrorSpy.mockRestore()

      const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))
      const body = await res.json()

      expect(res.status).toBe(500)
      expect(body).toEqual({ error: 'SMS is not configured' })
      expect(messagesCreate).not.toHaveBeenCalled()

      // The point of checking before the rotation: a resend that cannot produce a
      // working link must leave the official's existing link intact, rather than
      // revoking it to replace it with a dead one.
      expect(officialsUpdateBuilder.update).not.toHaveBeenCalled()
    }
  )

  it('sends a link built from the configured origin when it is usable', async () => {
    // Mutation check for the two cases above: delete the guard and they fail,
    // break the link construction and this one does.
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)

    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
    })
    const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026', tier: 'professional' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(tenantsBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)
    messagesCreate.mockResolvedValue({ sid: 'SM1', numSegments: '2' })

    await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('https://app.example.com/invite/tok-new'),
      })
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
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026', tier: 'professional' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(tenantsBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
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
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026', tier: 'professional' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(tenantsBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
    vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(releaseInviteRateLimit).not.toHaveBeenCalled()
  })

  // N24: the monthly SMS spend cap.
  describe('N24 monthly spend cap', () => {
    function cappedService(rows: Record<string, unknown>[]) {
      vi.mocked(createSupabaseServiceClient).mockReturnValue({
        from: () => ({
          select: () => ({
            eq: () => ({ gte: () => Promise.resolve({ data: rows, error: null }) }),
          }),
        }),
      } as never)
    }

    function arrange(tier: string) {
      vi.mocked(requireTenantAdmin).mockResolvedValue({
        user: { id: 'admin-1' },
        role: 'tenant_admin',
      } as never)
      const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
      const fromMock = vi.fn()
      fromMock
        .mockReturnValueOnce(
          chain({
            data: { id: 'off-1', name: 'Anna', phone: '46701234567', invite_status: 'invited' },
          })
        )
        .mockReturnValueOnce(chain({ data: { name: 'Viadal 2026', tier } }))
        .mockReturnValueOnce(officialsUpdateBuilder)
      vi.mocked(createSupabaseServerClient).mockReturnValue({ from: fromMock } as never)
      return officialsUpdateBuilder
    }

    it('returns 429 and does not send when the cap is reached', async () => {
      arrange('standard')
      cappedService([{ segments: 200, status: 'sent' }])

      const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

      // 429, not 502: nothing failed, and the condition clears by itself at
      // the start of next month.
      expect(res.status).toBe(429)
      expect(messagesCreate).not.toHaveBeenCalled()
    })

    it('does NOT rotate the invite token when the cap blocks the resend', async () => {
      // The rotation kills the previous link irreversibly. Blocking after it
      // would leave the official with a dead link and no replacement —
      // strictly worse than never pressing resend.
      const officialsUpdateBuilder = arrange('standard')
      cappedService([{ segments: 200, status: 'sent' }])

      await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

      expect(officialsUpdateBuilder.update).not.toHaveBeenCalled()
    })

    it('releases the rate-limit slot a blocked resend reserved', async () => {
      arrange('standard')
      cappedService([{ segments: 200, status: 'sent' }])

      await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

      expect(releaseInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567')
    })

    it('sends normally for a tenant under its cap', async () => {
      arrange('professional')
      cappedService([{ segments: 1, status: 'sent' }])
      messagesCreate.mockResolvedValueOnce({ sid: 'SM1', numSegments: '1' })

      const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

      expect(res.status).toBe(200)
      expect(messagesCreate).toHaveBeenCalledTimes(1)
    })
  })
})

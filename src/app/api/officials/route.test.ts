import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { POST } from './route'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { checkInviteRateLimit, releaseInviteRateLimit } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/audit/log-audit-event'
import type { Database } from '@/types/database'
import twilio from 'twilio'

vi.mock('@/lib/auth/tenant', () => ({
  requireTenantAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkInviteRateLimit: vi.fn(),
  releaseInviteRateLimit: vi.fn(),
}))

vi.mock('@/lib/audit/log-audit-event', () => ({
  logAuditEvent: vi.fn(),
}))

const messagesCreate = vi.fn()
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.insert = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.upsert = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.neq = vi.fn(() => builder)
  builder.limit = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  return builder
}

/** No active official already holds the submitted phone number. */
const noDuplicate = () => chain({ data: null })

const createUser = vi.fn()
const deleteUser = vi.fn()
const rpc = vi.fn()

/** Default: auth.admin.createUser succeeds with a fresh auth.users id. */
function freshAuthUser(userId = 'auth-user-1') {
  createUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
}

/**
 * Every successful POST queries the session client's `officials`/`tenants`
 * three times in order: the duplicate-phone lookup, the officials insert,
 * then `tenants` for the SMS body. auth.admin.createUser and the
 * get_user_id_by_phone RPC have no RLS equivalent, so they stay on the
 * service client — see row #15 in docs/security/service-role-audit.md.
 * Tests pass the builders for everything after the duplicate check, which
 * defaults to "no duplicate found".
 */
function mockService(...afterDuplicateCheck: unknown[]) {
  const fromMock = vi.fn()
  fromMock.mockReturnValueOnce(noDuplicate())
  afterDuplicateCheck.forEach((builder) => fromMock.mockReturnValueOnce(builder))
  freshAuthUser()
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)
  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    auth: { admin: { createUser, deleteUser } },
    rpc,
  } as unknown as SupabaseClient<Database>)
  return fromMock
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/officials', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function asAdmin() {
  vi.mocked(requireTenantAdmin).mockResolvedValue({
    user: { id: 'admin-1' },
    role: 'tenant_admin',
  } as never)
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

describe('POST /api/officials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    process.env.TWILIO_ACCOUNT_SID = 'AC_test'
    process.env.TWILIO_AUTH_TOKEN = 'token_test'
    process.env.TWILIO_PHONE_NUMBER = '+15550001111'
    vi.mocked(checkInviteRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    vi.mocked(releaseInviteRateLimit).mockResolvedValue(undefined)
  })

  it('returns 400 for invalid input without checking auth or sending sms', async () => {
    const res = await POST(makeRequest({ tenantId: 'not-a-uuid', name: '', phone: '' }))

    expect(res.status).toBe(400)
    expect(requireTenantAdmin).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('returns the tenant admin auth error without inserting or sending sms', async () => {
    const errorResponse = { status: 403 }
    vi.mocked(requireTenantAdmin).mockResolvedValue({ error: errorResponse } as never)

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(res).toBe(errorResponse)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('validates tenantId via requireTenantAdmin before creating the invite', async () => {
    asAdmin()
    mockService(
      chain({ data: { id: 'off-1', invite_token: 'tok-abc' }, error: null }),
      chain({ data: { name: 'Viadal 2026' } })
    )

    await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(requireTenantAdmin).toHaveBeenCalledWith(TENANT_ID)
  })

  it('normalizes the phone, inserts the official, and sends the invite SMS with the confirmation text', async () => {
    asAdmin()

    const official = {
      id: 'off-1',
      tenant_id: TENANT_ID,
      name: 'Anna',
      phone: '0701234567',
      invite_status: 'invited',
      invite_token: 'tok-abc',
    }

    const officialsBuilder = chain({ data: official, error: null })
    mockService(officialsBuilder, chain({ data: { name: 'Viadal 2026' } }))

    const res = await POST(
      makeRequest({
        tenantId: TENANT_ID,
        name: 'Anna',
        phone: '070-123 45 67',
        phoneCountry: 'SE',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    // invite_token must never reach the client (F-SEC-06) — it's still used
    // server-side to build the SMS invite URL below.
    const { invite_token: _token, ...expectedOfficial } = official
    expect(body.official).toEqual(expectedOfficial)

    expect(officialsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        name: 'Anna',
        phone: '46701234567',
        invite_status: 'invited',
      })
    )

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Hi Anna, you have been invited as an official for Viadal 2026. Confirm your availability here: https://app.example.com/invite/tok-abc',
      from: '+15550001111',
      to: '+46701234567',
    })
  })

  it('never includes invite_token or invite_token_expires_at in the response body (F-SEC-06)', async () => {
    asAdmin()
    const official = {
      id: 'off-1',
      tenant_id: TENANT_ID,
      name: 'Anna',
      phone: '0701234567',
      invite_status: 'invited',
      invite_token: 'tok-abc',
      invite_token_expires_at: '2026-08-25T00:00:00.000Z',
    }
    mockService(chain({ data: official, error: null }), chain({ data: { name: 'Viadal 2026' } }))

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )
    const body = await res.json()

    expect(body.official).not.toHaveProperty('invite_token')
    expect(body.official).not.toHaveProperty('invite_token_expires_at')
  })

  it('falls back to "an event" in the confirmation text when the tenant has no name', async () => {
    asAdmin()
    const official = { id: 'off-1', name: 'Bo', phone: '0709998877', invite_token: 'tok-xyz' }
    mockService(chain({ data: official, error: null }), chain({ data: null }))

    await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Bo', phone: '0709998877', phoneCountry: 'SE' })
    )

    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Hi Bo, you have been invited as an official for an event. Confirm your availability here: https://app.example.com/invite/tok-xyz',
      })
    )
  })

  it('rejects a phone number already held by an active official, without inserting or sending', async () => {
    asAdmin()
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: 'existing-official' } }))
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('duplicate_phone')
    expect(insertBuilder.insert).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(releaseInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567')
  })

  it('returns 409 rather than 500 when the unique index rejects a concurrent insert', async () => {
    asAdmin()
    // Two requests can both pass the duplicate lookup; the index is the real guarantee.
    mockService(chain({ data: null, error: { code: '23505', message: 'duplicate key value' } }))

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('duplicate_phone')
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(releaseInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567')
  })

  it('allows a repeated name as long as the phone number differs', async () => {
    asAdmin()
    const officialsBuilder = chain({
      data: { id: 'off-2', name: 'Anna', phone: '0709998877', invite_token: 'tok-2' },
      error: null,
    })
    mockService(officialsBuilder, chain({ data: { name: 'Viadal 2026' } }))

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0709998877', phoneCountry: 'SE' })
    )

    expect(res.status).toBe(200)
    expect(officialsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Anna', phone: '46709998877' })
    )
  })

  it('keeps the created official and reports smsSent false when the invite SMS throws', async () => {
    asAdmin()

    const official = {
      id: 'off-1',
      tenant_id: TENANT_ID,
      name: 'Anna',
      phone: '0701234567',
      invite_status: 'invited',
      invite_token: 'tok-abc',
    }
    mockService(chain({ data: official, error: null }), chain({ data: { name: 'Viadal 2026' } }))
    messagesCreate.mockRejectedValueOnce(Object.assign(new Error('twilio down'), { code: 21211 }))

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )
    const body = await res.json()

    // Not a 500 — the row exists, so telling the admin it failed makes them retry
    // and create a duplicate. Resend is the recovery path.
    expect(res.status).toBe(200)
    const { invite_token: _token, ...expectedOfficial } = official
    expect(body.official).toEqual(expectedOfficial)
    expect(body.smsSent).toBe(false)
  })

  it('keeps the created official when the twilio client constructor itself throws', async () => {
    asAdmin()

    const official = { id: 'off-1', name: 'Anna', phone: '0701234567', invite_token: 'tok-abc' }
    mockService(chain({ data: official, error: null }), chain({ data: { name: 'Viadal 2026' } }))

    // twilio() validates the account SID synchronously and throws before any request
    // is made when it is set to a non-AC value — the real localhost failure mode.
    vi.mocked(twilio).mockImplementationOnce(() => {
      throw new Error('accountSid must start with AC')
    })

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    const { invite_token: _token2, ...expectedOfficial } = official
    expect(body.official).toEqual(expectedOfficial)
    expect(body.smsSent).toBe(false)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('reports smsSent true when the invite SMS is delivered', async () => {
    asAdmin()
    mockService(
      chain({ data: { id: 'off-1', invite_token: 'tok-abc' }, error: null }),
      chain({ data: { name: 'Viadal 2026' } })
    )

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(await res.json()).toMatchObject({ smsSent: true })
  })

  it('returns 500 and never sends sms when the insert fails', async () => {
    asAdmin()
    mockService(chain({ data: null, error: { message: 'boom' } }))

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(res.status).toBe(500)
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(releaseInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567')
  })

  it('returns 500 and releases the rate limit when the phone_exists lookup fails', async () => {
    asAdmin()
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(noDuplicate())
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)
    createUser.mockResolvedValue({
      data: null,
      error: { code: 'phone_exists', message: 'phone already registered' },
    })
    rpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } })
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      auth: { admin: { createUser, deleteUser } },
      rpc,
    } as unknown as SupabaseClient<Database>)

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(res.status).toBe(500)
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(releaseInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567')
  })

  it('returns 500 and releases the rate limit when createUser fails for a reason other than phone_exists', async () => {
    asAdmin()
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(noDuplicate())
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)
    createUser.mockResolvedValue({
      data: null,
      error: { code: 'unexpected_failure', message: 'boom' },
    })
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      auth: { admin: { createUser, deleteUser } },
      rpc,
    } as unknown as SupabaseClient<Database>)

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(res.status).toBe(500)
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(releaseInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567')
  })

  it('returns 429 with Retry-After when the invite rate limit is exceeded', async () => {
    asAdmin()
    vi.mocked(checkInviteRateLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(body.error).toBe('Too many invite attempts')
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('returns 503 when the rate limit check throws', async () => {
    asAdmin()
    vi.mocked(checkInviteRateLimit).mockRejectedValue(new Error('db down'))

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toBe('Rate limit check failed')
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('releases the invite rate limit when the invite SMS throws', async () => {
    asAdmin()
    const official = {
      id: 'off-1',
      tenant_id: TENANT_ID,
      name: 'Anna',
      phone: '0701234567',
      invite_status: 'invited',
      invite_token: 'tok-abc',
    }
    mockService(chain({ data: official, error: null }), chain({ data: { name: 'Viadal 2026' } }))
    messagesCreate.mockRejectedValueOnce(Object.assign(new Error('twilio down'), { code: 21211 }))

    await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(releaseInviteRateLimit).toHaveBeenCalledWith(TENANT_ID, '46701234567')
  })

  it('does not release the invite rate limit on the happy path', async () => {
    asAdmin()
    mockService(
      chain({ data: { id: 'off-1', invite_token: 'tok-abc' }, error: null }),
      chain({ data: { name: 'Viadal 2026' } })
    )

    await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(releaseInviteRateLimit).not.toHaveBeenCalled()
  })

  // SEC-07
  it('logs an official_invited audit event after the insert succeeds', async () => {
    asAdmin()
    mockService(
      chain({ data: { id: 'off-1', invite_token: 'tok-abc' }, error: null }),
      chain({ data: { name: 'Viadal 2026' } })
    )

    await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(logAuditEvent).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: 'admin-1',
      actorRole: 'tenant_admin',
      action: 'official_invited',
      targetType: 'official',
      targetId: 'off-1',
      detail: { phoneLast4: '4567' },
    })
  })

  it('does not log an audit event when the insert fails', async () => {
    asAdmin()
    mockService(chain({ data: null, error: { message: 'boom' } }))

    await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('does not log an audit event for a duplicate phone rejection', async () => {
    asAdmin()
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: 'existing-official' } }))
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    await POST(
      makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567', phoneCountry: 'SE' })
    )

    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})

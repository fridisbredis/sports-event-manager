import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAuthEvent } from '@/lib/audit/log-auth-event'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/audit/log-auth-event', () => ({
  logAuthEvent: vi.fn(),
}))

const TOKEN = '11111111-1111-1111-1111-111111111111'
const TENANT_ID = '22222222-2222-2222-2222-222222222222'
const OTHER_TENANT_ID = '33333333-3333-3333-3333-333333333333'
const USER_ID = 'user-1'
const PHONE = '+46701234567'

function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/officials/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

function mockAuthedUser(user: { id: string; phone?: string } | null) {
  const getUser = vi.fn().mockResolvedValue({ data: { user } })
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser },
  } as never)
  return getUser
}

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  return builder
}

function mockServiceClient(rpcResult: { data: unknown; error: unknown }, tenantResult?: unknown) {
  const rpc = vi.fn().mockResolvedValue(rpcResult)
  const from = tenantResult !== undefined ? vi.fn().mockReturnValue(chain(tenantResult)) : vi.fn()
  vi.mocked(createSupabaseServiceClient).mockResolvedValue({ rpc, from } as never)
  return { rpc, from }
}

const validBody = { token: TOKEN, name: 'Kalle Official', privacyAccepted: true as const }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/officials/confirm', () => {
  it('returns 400 for an invalid token or missing name', async () => {
    const res = await POST(makeRequest({ token: 'not-a-uuid', name: '', privacyAccepted: true }))

    expect(res.status).toBe(400)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it('returns 400 when privacyAccepted is false or missing', async () => {
    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna', privacyAccepted: false }))

    expect(res.status).toBe(400)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it('returns 401 when there is no authenticated user', async () => {
    mockAuthedUser(null)

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(401)
    expect(logAuthEvent).not.toHaveBeenCalled()
  })

  it('returns 403 when the authenticated user has no verified phone', async () => {
    mockAuthedUser({ id: USER_ID })

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(403)
    expect(logAuthEvent).not.toHaveBeenCalled()
  })

  it('authenticates via the Authorization bearer token when present', async () => {
    const getUser = mockAuthedUser(null)
    mockServiceClient({ data: null, error: { message: 'not_found' } })

    await POST(makeRequest(validBody, { Authorization: 'Bearer abc123' }))

    expect(getUser).toHaveBeenCalledWith('abc123')
  })

  it('falls back to the cookie session when there is no Authorization header', async () => {
    const getUser = mockAuthedUser(null)
    mockServiceClient({ data: null, error: { message: 'not_found' } })

    await POST(makeRequest(validBody))

    expect(getUser).toHaveBeenCalledWith()
  })

  it('returns 404 when the RPC reports the invite as not found', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient({ data: null, error: { message: 'not_found' } })

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.code).toBe('not_found')
  })

  it('returns 404 when the RPC reports the invite token as expired', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient({ data: null, error: { message: 'expired' } })

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.code).toBe('not_found')
  })

  it('returns 403 when the RPC reports a phone mismatch', async () => {
    mockAuthedUser({ id: USER_ID, phone: '+46709999999' })
    const { rpc } = mockServiceClient({ data: null, error: { message: 'phone_mismatch' } })

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('phone_mismatch')
    expect(rpc).toHaveBeenCalledWith('confirm_official_invite', {
      p_token: TOKEN,
      p_user_id: USER_ID,
      p_user_phone: '+46709999999',
      p_name: 'Kalle Official',
      p_privacy_accepted: true,
    })
  })

  it('returns 409 when the RPC reports the invite as already confirmed', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient({ data: null, error: { message: 'already_confirmed' } })

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(409)
    expect(logAuthEvent).not.toHaveBeenCalled()
  })

  it('returns 500 for an unrecognized RPC error', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient({ data: null, error: { message: 'boom' } })

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(500)
  })

  it('returns tenantSlug undefined when the tenant lookup finds nothing', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient(
      { data: { tenant_id: TENANT_ID, role_granted: true }, error: null },
      { data: null }
    )

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, tenantSlug: undefined })
  })

  it('logs a role_granted_via_invite_confirmation auth event when the RPC actually granted the role', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    const { rpc } = mockServiceClient(
      { data: { tenant_id: TENANT_ID, role_granted: true }, error: null },
      { data: { slug: 'viadal' } }
    )

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, tenantSlug: 'viadal' })
    expect(rpc).toHaveBeenCalledWith('confirm_official_invite', {
      p_token: TOKEN,
      p_user_id: USER_ID,
      p_user_phone: PHONE,
      p_name: 'Kalle Official',
      p_privacy_accepted: true,
    })
    expect(logAuthEvent).toHaveBeenCalledWith({
      phone: PHONE,
      event: 'role_granted_via_invite_confirmation',
      actorUserId: USER_ID,
      tenantId: TENANT_ID,
      detail: { role: 'official' },
    })
  })

  it('does not log an auth event when the RPC fails', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient({ data: null, error: { message: 'not_found' } })

    await POST(makeRequest(validBody))

    expect(logAuthEvent).not.toHaveBeenCalled()
  })

  // SEC-07 gap, fixed by migration 0043: confirm_official_invite (0017) does
  // `insert into user_roles (...) on conflict (user_id, tenant_id) do
  // nothing` — a successful RPC call does not always mean a grant happened.
  // 0043 makes the RPC return `role_granted` (via `get diagnostics ..
  // row_count` on the insert) so the route can tell a real grant apart from
  // a no-op conflict instead of logging unconditionally.
  it('does NOT log an audit event when the RPC succeeds but role_granted is false (on-conflict-do-nothing)', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient(
      { data: { tenant_id: TENANT_ID, role_granted: false }, error: null },
      { data: { slug: 'viadal' } }
    )

    const res = await POST(makeRequest(validBody))

    // The confirmation itself still succeeds — role_granted only gates the
    // audit write, not the HTTP response.
    expect(res.status).toBe(200)
    expect(logAuthEvent).not.toHaveBeenCalled()
  })

  it('trusts tenant_id verbatim from the RPC response with no cross-check against the request', async () => {
    // The route derives tenantId purely from `data.tenant_id` returned by the
    // RPC (a jsonb_build_object the server controls) — there is no tenantId
    // in the request body to compare it against, and no re-validation that
    // this tenant_id actually corresponds to a real, active tenant before
    // logging. If confirm_official_invite ever returned a stale or wrong
    // tenant_id (e.g. a future refactor reads it from the wrong local var),
    // this audit write would silently attribute the grant to the wrong
    // tenant with no test catching the mismatch. This test pins current
    // behavior: whatever the RPC returns is trusted as-is.
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient(
      { data: { tenant_id: OTHER_TENANT_ID, role_granted: true }, error: null },
      { data: { slug: 'x' } }
    )

    await POST(makeRequest(validBody))

    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTHER_TENANT_ID })
    )
  })

  it('does not await the audit write — a slow logAuthEvent does not delay the response', async () => {
    // logAuthEvent is called fire-and-forget (`void logAuthEvent(...)`, not
    // awaited), so a hung or slow auth_events insert must not add to this
    // route's latency. This proves the response resolves before the audit
    // write's promise ever settles.
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient(
      { data: { tenant_id: TENANT_ID, role_granted: true }, error: null },
      { data: { slug: 'viadal' } }
    )

    let auditResolved = false
    vi.mocked(logAuthEvent).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        setTimeout(() => {
          auditResolved = true
          resolve()
        }, 0)
      })
    )

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(200)
    expect(auditResolved).toBe(false)
  })

  it('a throw from logAuthEvent does not affect the confirmation response', async () => {
    // logAuthEvent is fail-safe internally (try/catch, logs via
    // logger.error), but this call site no longer awaits it either — even a
    // rejection that somehow escaped logAuthEvent's own try/catch cannot
    // turn a successful confirmation into a 500, because nothing here is
    // waiting on that promise to decide the response.
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient(
      { data: { tenant_id: TENANT_ID, role_granted: true }, error: null },
      { data: { slug: 'viadal' } }
    )
    vi.mocked(logAuthEvent).mockRejectedValueOnce(new Error('audit db unreachable'))

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(200)
  })
})

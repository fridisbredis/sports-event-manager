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

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/officials/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function mockAuthedUser(user: { id: string; phone?: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
  } as never)
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

  it('returns 409 when the RPC reports the invite as already confirmed', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient({ data: null, error: { message: 'already_confirmed' } })

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(409)
    expect(logAuthEvent).not.toHaveBeenCalled()
  })

  it('logs a role_granted_via_invite_confirmation auth event when the RPC actually granted the role', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient(
      { data: { tenant_id: TENANT_ID, role_granted: true }, error: null },
      { data: { slug: 'viadal' } }
    )

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(200)
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

  it('the audit write blocks the HTTP response — a slow logAuthEvent delays confirmation', async () => {
    // await logAuthEvent(...) sits directly in the request path before the
    // response is built. logAuthEvent is fail-safe against throwing, but
    // nothing here makes it fail-safe against being SLOW: a hung or slow
    // auth_events insert (e.g. contention, a slow replica) adds directly to
    // this route's latency, coupling invite-confirmation UX to audit-writer
    // health. Fire-and-forget (no await, or an explicit .catch with no
    // await) would decouple them; this test proves the current code does not.
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient(
      { data: { tenant_id: TENANT_ID, role_granted: true }, error: null },
      { data: { slug: 'viadal' } }
    )

    let resolveAudit!: () => void
    vi.mocked(logAuthEvent).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveAudit = resolve
      })
    )

    let responded = false
    const pending = POST(makeRequest(validBody)).then((res) => {
      responded = true
      return res
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(responded).toBe(false)

    resolveAudit()
    const res = await pending
    expect(responded).toBe(true)
    expect(res.status).toBe(200)
  })

  it('an unexpected throw from logAuthEvent turns a successful confirmation into a 500', async () => {
    // Same missing-second-line-of-defense issue as confirmOfficialInvite in
    // tenant.ts: logAuthEvent's own try/catch is the only thing standing
    // between an audit-write failure and the user-visible response. There is
    // no try/catch around this call site, so if that internal safety net
    // ever has a gap, an official who successfully confirmed their invite
    // (the RPC already committed) would see a 500 and have no idea whether
    // they are actually confirmed or not.
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient(
      { data: { tenant_id: TENANT_ID, role_granted: true }, error: null },
      { data: { slug: 'viadal' } }
    )
    vi.mocked(logAuthEvent).mockRejectedValueOnce(new Error('audit db unreachable'))

    await expect(POST(makeRequest(validBody))).rejects.toThrow('audit db unreachable')
  })
})

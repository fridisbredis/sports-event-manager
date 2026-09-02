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

  it('logs a role_granted_via_invite_confirmation auth event after the RPC succeeds', async () => {
    mockAuthedUser({ id: USER_ID, phone: PHONE })
    mockServiceClient({ data: { tenant_id: TENANT_ID }, error: null }, { data: { slug: 'viadal' } })

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
})

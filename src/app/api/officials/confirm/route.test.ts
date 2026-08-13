import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockServerClient(user: { id: string; phone?: string } | null) {
  const getUser = vi.fn().mockResolvedValue({ data: { user } })
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ auth: { getUser } } as never)
  return getUser
}

function mockServiceClient({
  rpcResult,
  tenantResult,
}: {
  rpcResult: { data: unknown; error: { message: string } | null }
  tenantResult?: unknown
}) {
  const rpc = vi.fn().mockResolvedValue(rpcResult)
  const fromMock =
    tenantResult !== undefined ? vi.fn().mockReturnValue(chain(tenantResult)) : vi.fn()
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc, from: fromMock } as never)
  return { rpc, fromMock }
}

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/officials/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

const TOKEN = '22222222-2222-2222-2222-222222222222'
const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const PHONE = '+46701234567'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/officials/confirm', () => {
  it('returns 400 for an invalid token or missing name', async () => {
    const res = await POST(makeRequest({ token: 'not-a-uuid', name: '' }))

    expect(res.status).toBe(400)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it('returns 401 when there is no authenticated user', async () => {
    mockServerClient(null)

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))

    expect(res.status).toBe(401)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('returns 403 when the authenticated user has no verified phone', async () => {
    mockServerClient({ id: 'user-1' })

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('phone_mismatch')
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('authenticates via the Authorization bearer token when present', async () => {
    const getUser = mockServerClient(null)
    mockServiceClient({ rpcResult: { data: null, error: { message: 'not_found' } } })

    await POST(makeRequest({ token: TOKEN, name: 'Anna' }, { Authorization: 'Bearer abc123' }))

    expect(getUser).toHaveBeenCalledWith('abc123')
  })

  it('falls back to the cookie session when there is no Authorization header', async () => {
    const getUser = mockServerClient(null)
    mockServiceClient({ rpcResult: { data: null, error: { message: 'not_found' } } })

    await POST(makeRequest({ token: TOKEN, name: 'Anna' }))

    expect(getUser).toHaveBeenCalledWith()
  })

  it('returns 404 when the RPC reports the invite as not found', async () => {
    mockServerClient({ id: 'user-1', phone: PHONE })
    mockServiceClient({ rpcResult: { data: null, error: { message: 'not_found' } } })

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.code).toBe('not_found')
  })

  it('returns 404 when the RPC reports the invite token as expired', async () => {
    mockServerClient({ id: 'user-1', phone: PHONE })
    mockServiceClient({ rpcResult: { data: null, error: { message: 'expired' } } })

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.code).toBe('not_found')
  })

  it('returns 403 when the RPC reports a phone mismatch', async () => {
    mockServerClient({ id: 'user-1', phone: '+46709999999' })
    const { rpc } = mockServiceClient({
      rpcResult: { data: null, error: { message: 'phone_mismatch' } },
    })

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('phone_mismatch')
    expect(rpc).toHaveBeenCalledWith('confirm_official_invite', {
      p_token: TOKEN,
      p_user_id: 'user-1',
      p_user_phone: '+46709999999',
      p_name: 'Anna',
    })
  })

  it('returns 409 when the RPC reports the invite as already confirmed (concurrent attempt)', async () => {
    // Simulates the loser of the row lock in confirm_official_invite: a second,
    // concurrent request for the same invite_token arrives after the first has
    // already flipped invite_status to 'confirmed'.
    mockServerClient({ id: 'user-2', phone: PHONE })
    mockServiceClient({ rpcResult: { data: null, error: { message: 'already_confirmed' } } })

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('already_confirmed')
  })

  it('returns 500 for an unrecognized RPC error', async () => {
    mockServerClient({ id: 'user-1', phone: PHONE })
    mockServiceClient({ rpcResult: { data: null, error: { message: 'boom' } } })

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))

    expect(res.status).toBe(500)
  })

  it('confirms the official via RPC with the matching phone and returns the tenant slug', async () => {
    mockServerClient({ id: 'user-1', phone: PHONE })
    const { rpc } = mockServiceClient({
      rpcResult: { data: { tenant_id: TENANT_ID }, error: null },
      tenantResult: { data: { slug: 'viadal' } },
    })

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, tenantSlug: 'viadal' })
    expect(rpc).toHaveBeenCalledWith('confirm_official_invite', {
      p_token: TOKEN,
      p_user_id: 'user-1',
      p_user_phone: PHONE,
      p_name: 'Anna',
    })
  })

  it('returns tenantSlug undefined when the tenant lookup finds nothing', async () => {
    mockServerClient({ id: 'user-1', phone: PHONE })
    mockServiceClient({
      rpcResult: { data: { tenant_id: TENANT_ID }, error: null },
      tenantResult: { data: null },
    })

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, tenantSlug: undefined })
  })
})

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
  for (const method of ['select', 'eq', 'update', 'upsert']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockServerClient(user: { id: string } | null) {
  const getUser = vi.fn().mockResolvedValue({ data: { user } })
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ auth: { getUser } } as never)
  return getUser
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
const OFFICIAL_ID = '33333333-3333-3333-3333-333333333333'

function futureIso() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

function pastIso() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
}

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

  it('authenticates via the Authorization bearer token when present', async () => {
    const getUser = mockServerClient(null)
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    await POST(makeRequest({ token: TOKEN, name: 'Anna' }, { Authorization: 'Bearer abc123' }))

    expect(getUser).toHaveBeenCalledWith('abc123')
  })

  it('falls back to the cookie session when there is no Authorization header', async () => {
    const getUser = mockServerClient(null)
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    await POST(makeRequest({ token: TOKEN, name: 'Anna' }))

    expect(getUser).toHaveBeenCalledWith()
  })

  it('returns 404 when no official matches the invite token', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.code).toBe('not_found')
  })

  it('returns 404 when the invite is not in the invited state', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi.fn().mockReturnValueOnce(
      chain({
        data: {
          id: OFFICIAL_ID,
          tenant_id: TENANT_ID,
          invite_status: 'confirmed',
          invite_token_expires_at: futureIso(),
        },
      })
    )
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))

    expect(res.status).toBe(404)
  })

  it('returns 404 when the invite has no expiry set', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi.fn().mockReturnValueOnce(
      chain({
        data: {
          id: OFFICIAL_ID,
          tenant_id: TENANT_ID,
          invite_status: 'invited',
          invite_token_expires_at: null,
        },
      })
    )
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))

    expect(res.status).toBe(404)
  })

  it('returns 404 when the invite token has expired', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi.fn().mockReturnValueOnce(
      chain({
        data: {
          id: OFFICIAL_ID,
          tenant_id: TENANT_ID,
          invite_status: 'invited',
          invite_token_expires_at: pastIso(),
        },
      })
    )
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))

    expect(res.status).toBe(404)
  })

  it('confirms the official, upserts the official role, and returns the tenant slug', async () => {
    mockServerClient({ id: 'user-1' })

    const officialSelectBuilder = chain({
      data: {
        id: OFFICIAL_ID,
        tenant_id: TENANT_ID,
        invite_status: 'invited',
        invite_token_expires_at: futureIso(),
      },
    })
    const tenantBuilder = chain({ data: { slug: 'viadal' } })
    const officialUpdateBuilder = chain({ data: null, error: null })
    const userRolesBuilder = chain({ data: null, error: null })

    const fromMock = vi
      .fn()
      .mockReturnValueOnce(officialSelectBuilder)
      .mockReturnValueOnce(tenantBuilder)
      .mockReturnValueOnce(officialUpdateBuilder)
      .mockReturnValueOnce(userRolesBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, tenantSlug: 'viadal' })

    expect(officialUpdateBuilder.update).toHaveBeenCalledWith({
      user_id: 'user-1',
      invite_status: 'confirmed',
      invite_token: null,
      invite_token_expires_at: null,
      name: 'Anna',
    })
    expect(officialUpdateBuilder.eq).toHaveBeenCalledWith('id', OFFICIAL_ID)

    expect(userRolesBuilder.upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', tenant_id: TENANT_ID, role: 'official' },
      { onConflict: 'user_id,tenant_id' }
    )
  })

  it('returns tenantSlug undefined when the tenant lookup finds nothing', async () => {
    mockServerClient({ id: 'user-1' })

    const officialSelectBuilder = chain({
      data: {
        id: OFFICIAL_ID,
        tenant_id: TENANT_ID,
        invite_status: 'invited',
        invite_token_expires_at: futureIso(),
      },
    })
    const tenantBuilder = chain({ data: null })
    const officialUpdateBuilder = chain({ data: null, error: null })
    const userRolesBuilder = chain({ data: null, error: null })

    const fromMock = vi
      .fn()
      .mockReturnValueOnce(officialSelectBuilder)
      .mockReturnValueOnce(tenantBuilder)
      .mockReturnValueOnce(officialUpdateBuilder)
      .mockReturnValueOnce(userRolesBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ token: TOKEN, name: 'Anna' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, tenantSlug: undefined })
  })
})

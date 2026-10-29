import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import { createSupabaseServerClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

const VALID = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'BPk', auth: 'aut' },
}

function mockClient(user: { id: string } | null, result: { error: unknown } = { error: null }) {
  const upsert = vi.fn().mockResolvedValue(result)
  const eq2 = vi.fn().mockResolvedValue(result)
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const del = vi.fn(() => ({ eq: eq1 }))
  const from = vi.fn(() => ({ upsert, delete: del }))
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from,
  } as never)
  return { from, upsert, del, eq1, eq2 }
}

function request(method: 'PUT' | 'DELETE', body: unknown) {
  return new NextRequest('http://localhost/api/account/push-subscription', {
    method,
    body: JSON.stringify(body),
    headers: { 'user-agent': 'TestPhone/1.0' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PUT /api/account/push-subscription', () => {
  it('returns 401 without a session and writes nothing', async () => {
    const { from } = mockClient(null)

    const res = await PUT(request('PUT', VALID))

    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('upserts on endpoint, owned by the caller', async () => {
    const { from, upsert } = mockClient({ id: 'user-1' })

    const res = await PUT(request('PUT', VALID))

    expect(res.status).toBe(200)
    expect(from).toHaveBeenCalledWith('push_subscriptions')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        endpoint: VALID.endpoint,
        p256dh: 'BPk',
        auth: 'aut',
        user_agent: 'TestPhone/1.0',
      }),
      { onConflict: 'endpoint' }
    )
  })

  // Push service endpoints are always https. Anything else is not a real
  // subscription, and storing it would point the sender at an arbitrary URL.
  it.each([
    ['http endpoint', { ...VALID, endpoint: 'http://push.example/x' }],
    ['non-URL endpoint', { ...VALID, endpoint: 'javascript:alert(1)' }],
    ['missing keys', { endpoint: VALID.endpoint }],
    ['empty auth key', { ...VALID, keys: { p256dh: 'x', auth: '' } }],
  ])('returns 400 for %s', async (_label, body) => {
    const { upsert } = mockClient({ id: 'user-1' })

    const res = await PUT(request('PUT', body))

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('returns 500 when the write fails', async () => {
    mockClient({ id: 'user-1' }, { error: { code: '42501', message: 'rls' } })

    const res = await PUT(request('PUT', VALID))

    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/account/push-subscription', () => {
  it('returns 401 without a session', async () => {
    const { from } = mockClient(null)

    const res = await DELETE(request('DELETE', { endpoint: VALID.endpoint }))

    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  // Defense in depth: RLS already limits the delete to the caller's rows, and
  // the handler filters on user_id as well so a policy regression cannot turn
  // this into "delete anyone's device by endpoint".
  it("deletes only the caller's row for that endpoint", async () => {
    const { eq1, eq2 } = mockClient({ id: 'user-1' })

    const res = await DELETE(request('DELETE', { endpoint: VALID.endpoint }))

    expect(res.status).toBe(200)
    expect(eq1).toHaveBeenCalledWith('user_id', 'user-1')
    expect(eq2).toHaveBeenCalledWith('endpoint', VALID.endpoint)
  })
})

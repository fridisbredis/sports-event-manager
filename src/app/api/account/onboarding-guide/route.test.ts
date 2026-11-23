import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import { createSupabaseServerClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

const EVENT_ID = '7f3c1a52-2b8e-4d4a-9c61-0e5b8f2a9d10'

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
  return new NextRequest('http://localhost/api/account/onboarding-guide', {
    method,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PUT /api/account/onboarding-guide', () => {
  it('returns 401 without a session and writes nothing', async () => {
    const { from } = mockClient(null)

    const res = await PUT(request('PUT', { eventId: EVENT_ID }))

    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects an event id that is not a uuid', async () => {
    const { from } = mockClient({ id: 'user-1' })

    const res = await PUT(request('PUT', { eventId: 'not-a-uuid' }))

    expect(res.status).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('records the dismissal for the caller, ignoring a repeat', async () => {
    const { from, upsert } = mockClient({ id: 'user-1' })

    const res = await PUT(request('PUT', { eventId: EVENT_ID }))

    expect(res.status).toBe(200)
    expect(from).toHaveBeenCalledWith('admin_guide_dismissals')
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', event_id: EVENT_ID },
      { onConflict: 'user_id,event_id', ignoreDuplicates: true }
    )
  })

  it('returns 500 when the write fails', async () => {
    mockClient({ id: 'user-1' }, { error: { message: 'boom' } })

    const res = await PUT(request('PUT', { eventId: EVENT_ID }))

    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/account/onboarding-guide', () => {
  it('returns 401 without a session', async () => {
    const { from } = mockClient(null)

    const res = await DELETE(request('DELETE', { eventId: EVENT_ID }))

    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it("deletes only the caller's row for that event", async () => {
    const { del, eq1, eq2 } = mockClient({ id: 'user-1' })

    const res = await DELETE(request('DELETE', { eventId: EVENT_ID }))

    expect(res.status).toBe(200)
    expect(del).toHaveBeenCalled()
    expect(eq1).toHaveBeenCalledWith('user_id', 'user-1')
    expect(eq2).toHaveBeenCalledWith('event_id', EVENT_ID)
  })

  it('returns 500 when the delete fails', async () => {
    mockClient({ id: 'user-1' }, { error: { message: 'boom' } })

    const res = await DELETE(request('DELETE', { eventId: EVENT_ID }))

    expect(res.status).toBe(500)
  })
})

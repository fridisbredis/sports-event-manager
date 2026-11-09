import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from './route'
import { createSupabaseServerClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

function mockClient(user: { id: string } | null, result: { error: unknown } = { error: null }) {
  const upsert = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockResolvedValue(result)
  const del = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ upsert, delete: del }))
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from,
  } as never)
  return { from, upsert, del, eq }
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/account/ice', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PUT /api/account/ice', () => {
  it('returns 401 without a session and writes nothing', async () => {
    const { from } = mockClient(null)

    const res = await PUT(request({ phone: '', name: '', relation: '' }))

    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('upserts the normalized contact on the caller’s own user_id', async () => {
    const { from, upsert } = mockClient({ id: 'user-1' })

    const res = await PUT(request({ phone: '070-123 45 67', name: ' Göran ', relation: 'Partner' }))

    expect(res.status).toBe(200)
    expect(from).toHaveBeenCalledWith('user_ice_contacts')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        phone: '46701234567',
        name: 'Göran',
        relation: 'Partner',
      }),
      { onConflict: 'user_id' }
    )
  })

  it('stores a partial contact with nulls for the missing fields', async () => {
    const { upsert } = mockClient({ id: 'user-1' })

    await PUT(request({ phone: '', name: 'Göran', relation: '' }))

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ phone: null, name: 'Göran', relation: null }),
      expect.anything()
    )
  })

  it('deletes the row when every field is cleared', async () => {
    const { upsert, del, eq } = mockClient({ id: 'user-1' })

    const res = await PUT(request({ phone: ' ', name: '', relation: '' }))

    expect(res.status).toBe(200)
    expect(upsert).not.toHaveBeenCalled()
    expect(del).toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('rejects an invalid phone with a code the form can map', async () => {
    const { from } = mockClient({ id: 'user-1' })

    const res = await PUT(request({ phone: '12', name: '', relation: '' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'invalid_phone' })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a malformed body', async () => {
    mockClient({ id: 'user-1' })

    const res = await PUT(request({ phone: 1 }))

    expect(res.status).toBe(400)
  })

  it('returns 500 when the write fails', async () => {
    mockClient({ id: 'user-1' }, { error: { message: 'boom' } })

    const res = await PUT(request({ phone: '', name: 'Göran', relation: '' }))

    expect(res.status).toBe(500)
  })
})

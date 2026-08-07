import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from './route'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'update']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(result))
  return builder
}

function mockServerClient(user: { id: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never)
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/account', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/account', () => {
  it('returns 401 when there is no authenticated user', async () => {
    mockServerClient(null)

    const res = await PATCH(makeRequest({ mode: 'admin', tenantId: TENANT_ID, name: 'Anna' }))

    expect(res.status).toBe(401)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  describe('admin mode', () => {
    it('returns 400 when name is missing', async () => {
      mockServerClient({ id: 'user-1' })
      const updateUserById = vi.fn()
      vi.mocked(createSupabaseServiceClient).mockReturnValue({
        auth: { admin: { updateUserById } },
      } as never)

      const res = await PATCH(makeRequest({ mode: 'admin', tenantId: TENANT_ID, name: '' }))

      expect(res.status).toBe(400)
      expect(updateUserById).not.toHaveBeenCalled()
    })

    it('updates the authenticated user metadata and returns ok', async () => {
      mockServerClient({ id: 'user-1' })
      const updateUserById = vi.fn().mockResolvedValue({ error: null })
      vi.mocked(createSupabaseServiceClient).mockReturnValue({
        auth: { admin: { updateUserById } },
      } as never)

      const res = await PATCH(makeRequest({ mode: 'admin', tenantId: TENANT_ID, name: 'Anna' }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ ok: true })
      expect(updateUserById).toHaveBeenCalledWith('user-1', { user_metadata: { name: 'Anna' } })
    })

    it('returns 500 when the metadata update fails', async () => {
      mockServerClient({ id: 'user-1' })
      const updateUserById = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
      vi.mocked(createSupabaseServiceClient).mockReturnValue({
        auth: { admin: { updateUserById } },
      } as never)

      const res = await PATCH(makeRequest({ mode: 'admin', tenantId: TENANT_ID, name: 'Anna' }))

      expect(res.status).toBe(500)
    })
  })

  describe('official mode (default, no mode field)', () => {
    it('returns 400 when tenantId is invalid or smsOptOut is missing', async () => {
      mockServerClient({ id: 'user-1' })
      const fromMock = vi.fn()
      vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

      const res = await PATCH(makeRequest({ tenantId: 'not-a-uuid', name: 'Anna' }))

      expect(res.status).toBe(400)
      expect(fromMock).not.toHaveBeenCalled()
    })

    it('scopes the update to the authenticated user within the given tenant', async () => {
      mockServerClient({ id: 'user-1' })
      const builder = chain({ data: { id: 'off-1' }, error: null })
      const fromMock = vi.fn().mockReturnValueOnce(builder)
      vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

      await PATCH(makeRequest({ tenantId: TENANT_ID, name: 'Anna', smsOptOut: true }))

      expect(fromMock).toHaveBeenCalledWith('officials')
      expect(builder.update).toHaveBeenCalledWith({ name: 'Anna', sms_opt_out: true })
      expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
      expect(builder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    })

    it('returns ok when the update succeeds', async () => {
      mockServerClient({ id: 'user-1' })
      const builder = chain({ data: { id: 'off-1' }, error: null })
      const fromMock = vi.fn().mockReturnValueOnce(builder)
      vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

      const res = await PATCH(makeRequest({ tenantId: TENANT_ID, name: 'Anna', smsOptOut: false }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ ok: true })
    })

    it('returns 500 when the update reports an error', async () => {
      mockServerClient({ id: 'user-1' })
      const builder = chain({ data: null, error: { message: 'boom' } })
      const fromMock = vi.fn().mockReturnValueOnce(builder)
      vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

      const res = await PATCH(makeRequest({ tenantId: TENANT_ID, name: 'Anna', smsOptOut: false }))

      expect(res.status).toBe(500)
    })

    it('returns 500 when no matching official row is found, even without an error', async () => {
      mockServerClient({ id: 'user-1' })
      const builder = chain({ data: null, error: null })
      const fromMock = vi.fn().mockReturnValueOnce(builder)
      vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

      const res = await PATCH(makeRequest({ tenantId: TENANT_ID, name: 'Anna', smsOptOut: false }))

      expect(res.status).toBe(500)
    })

    it('rejects explicit mode: "official" values other than the literal', async () => {
      mockServerClient({ id: 'user-1' })
      const fromMock = vi.fn()
      vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

      const res = await PATCH(
        makeRequest({ mode: 'something-else', tenantId: TENANT_ID, name: 'Anna', smsOptOut: false })
      )

      expect(res.status).toBe(400)
      expect(fromMock).not.toHaveBeenCalled()
    })
  })
})

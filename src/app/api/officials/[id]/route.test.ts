import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from './route'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

vi.mock('@/lib/auth/tenant', () => ({
  requireTenantAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'delete', 'update']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function makeRequest(tenantId?: string) {
  const url = tenantId
    ? `http://localhost/api/officials/off-1?tenantId=${encodeURIComponent(tenantId)}`
    : 'http://localhost/api/officials/off-1'
  return new NextRequest(url, { method: 'DELETE' })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const OFFICIAL_ID = 'off-1'
const USER_ID = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /api/officials/[id]', () => {
  it('returns 400 when tenantId is missing from the query string', async () => {
    const res = await DELETE(makeRequest(), makeParams(OFFICIAL_ID))

    expect(res.status).toBe(400)
    expect(requireTenantAdmin).not.toHaveBeenCalled()
  })

  it('returns 400 when tenantId is not a valid uuid', async () => {
    const res = await DELETE(makeRequest('not-a-uuid'), makeParams(OFFICIAL_ID))

    expect(res.status).toBe(400)
    expect(requireTenantAdmin).not.toHaveBeenCalled()
  })

  it('returns the tenant admin auth error without touching the db', async () => {
    const errorResponse = { status: 403 }
    vi.mocked(requireTenantAdmin).mockResolvedValue({ error: errorResponse } as never)

    const res = await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(res).toBe(errorResponse)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('scopes the official lookup to both id and tenantId, and returns 404 when not found', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const selectBuilder = chain({ data: null })
    const fromMock = vi.fn().mockReturnValueOnce(selectBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(res.status).toBe(404)
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(selectBuilder.eq).toHaveBeenCalledWith('id', OFFICIAL_ID)
    expect(selectBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('returns 500 and does not report success when the removal update fails', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const selectBuilder = chain({ data: { id: OFFICIAL_ID, tenant_id: TENANT_ID } })
    const assignmentsBuilder = chain({ data: null, error: null })
    const updateBuilder = chain({ data: null, error: { message: 'boom' } })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(selectBuilder)
      .mockReturnValueOnce(assignmentsBuilder)
      .mockReturnValueOnce(updateBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(res.status).toBe(500)
  })

  it('frees tenant-scoped assignments and marks the official removed on success', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const selectBuilder = chain({ data: { id: OFFICIAL_ID, tenant_id: TENANT_ID } })
    const assignmentsBuilder = chain({ data: null, error: null })
    const updateBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(selectBuilder)
      .mockReturnValueOnce(assignmentsBuilder)
      .mockReturnValueOnce(updateBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })

    expect(fromMock).toHaveBeenNthCalledWith(2, 'assignments')
    expect(assignmentsBuilder.delete).toHaveBeenCalled()
    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('official_id', OFFICIAL_ID)
    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)

    expect(fromMock).toHaveBeenNthCalledWith(3, 'officials')
    // Every live handle on the row is dropped with the status: user_id, so a later
    // re-invite cannot produce two rows sharing (user_id, tenant_id), and the invite
    // token, so the removed official's old link stops being a valid bearer secret.
    expect(updateBuilder.update).toHaveBeenCalledWith({
      invite_status: 'removed',
      user_id: null,
      invite_token: null,
      invite_token_expires_at: null,
    })
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', OFFICIAL_ID)
    expect(updateBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  // Soft-deleting the officials row is not enough: resolvePostLoginRedirect reads
  // user_roles alone, so a surviving 'official' row keeps redirecting that phone into
  // this tenant permanently, however many later invites are issued elsewhere.
  it('revokes the official user_roles row for the tenant when the official had a user', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const selectBuilder = chain({
      data: { id: OFFICIAL_ID, tenant_id: TENANT_ID, user_id: USER_ID },
    })
    const assignmentsBuilder = chain({ data: null, error: null })
    const updateBuilder = chain({ data: null, error: null })
    const rolesBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(selectBuilder)
      .mockReturnValueOnce(assignmentsBuilder)
      .mockReturnValueOnce(updateBuilder)
      .mockReturnValueOnce(rolesBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(res.status).toBe(200)
    expect(fromMock).toHaveBeenNthCalledWith(4, 'user_roles')
    expect(rolesBuilder.delete).toHaveBeenCalled()
    expect(rolesBuilder.eq).toHaveBeenCalledWith('user_id', USER_ID)
    expect(rolesBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    // user_roles is unique per (user_id, tenant_id), not per role — a tenant_admin who
    // also has an officials row holds a single tenant_admin row here, so an unscoped
    // delete would revoke their admin access.
    expect(rolesBuilder.eq).toHaveBeenCalledWith('role', 'official')
  })

  it('does not touch user_roles when the official was never linked to a user', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const selectBuilder = chain({
      data: { id: OFFICIAL_ID, tenant_id: TENANT_ID, user_id: null },
    })
    const assignmentsBuilder = chain({ data: null, error: null })
    const updateBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(selectBuilder)
      .mockReturnValueOnce(assignmentsBuilder)
      .mockReturnValueOnce(updateBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(res.status).toBe(200)
    expect(fromMock).toHaveBeenCalledTimes(3)
    expect(fromMock).not.toHaveBeenCalledWith('user_roles')
  })

  it('returns 500 when the role revocation fails, so the caller retries', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const selectBuilder = chain({
      data: { id: OFFICIAL_ID, tenant_id: TENANT_ID, user_id: USER_ID },
    })
    const assignmentsBuilder = chain({ data: null, error: null })
    const updateBuilder = chain({ data: null, error: null })
    const rolesBuilder = chain({ data: null, error: { message: 'boom' } })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(selectBuilder)
      .mockReturnValueOnce(assignmentsBuilder)
      .mockReturnValueOnce(updateBuilder)
      .mockReturnValueOnce(rolesBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(res.status).toBe(500)
  })
})

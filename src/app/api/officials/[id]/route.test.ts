import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from './route'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log-audit-event'

vi.mock('@/lib/auth/tenant', () => ({
  requireTenantAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/audit/log-audit-event', () => ({
  logAuditEvent: vi.fn(),
}))

function makeRequest(tenantId?: string) {
  const url = tenantId
    ? `http://localhost/api/officials/off-1?tenantId=${encodeURIComponent(tenantId)}`
    : 'http://localhost/api/officials/off-1'
  return new NextRequest(url, { method: 'DELETE' })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function mockRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as never)
  return rpc
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const OFFICIAL_ID = 'off-1'

beforeEach(() => {
  vi.clearAllMocks()
})

// F-SEC-03/F-REL-04 (migration 0025): the route delegates the whole removal
// — freeing assignments, soft-deleting officials, revoking the official
// user_roles row — to the remove_official RPC in one transaction, called on
// the session client (SECURITY INVOKER, relies on the caller's own RLS
// grants). These tests cover the route's HTTP contract; the RPC's actual
// three-step behavior under RLS is covered by
// tests/integration/sec03-write-migration.test.ts against a real database.
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
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it('calls remove_official with the official id and tenant id from the request', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const rpc = mockRpc({ data: { ok: true, user_id: 'user-1' }, error: null })

    const res = await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('remove_official', {
      p_official_id: OFFICIAL_ID,
      p_tenant_id: TENANT_ID,
    })
  })

  it('returns 404 when remove_official raises not_found', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    mockRpc({ data: null, error: { message: 'not_found' } })

    const res = await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(res.status).toBe(404)
  })

  it('returns 500 and does not report success on any other rpc error', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    mockRpc({ data: null, error: { message: 'boom' } })

    const res = await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(res.status).toBe(500)
  })

  // SEC-07
  it('logs a role_revoked audit event with the revoked user_id after remove_official succeeds', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    mockRpc({ data: { ok: true, user_id: 'user-1' }, error: null })

    await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(logAuditEvent).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: 'admin-1',
      actorRole: 'tenant_admin',
      action: 'role_revoked',
      targetType: 'user_role',
      targetId: 'user-1',
      detail: { officialId: OFFICIAL_ID },
    })
  })

  // SEC-07-rest (migration 0048): an official who never accepted their
  // invite has no user_id to revoke — remove_official returns user_id: null
  // in that case, and the audit event's targetId must reflect that rather
  // than crashing on a missing key.
  it('logs targetId: null when the removed official never had a user_id', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    mockRpc({ data: { ok: true, user_id: null }, error: null })

    await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ targetId: null }))
  })

  it('does not log an audit event when remove_official fails', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    mockRpc({ data: null, error: { message: 'boom' } })

    await DELETE(makeRequest(TENANT_ID), makeParams(OFFICIAL_ID))

    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})

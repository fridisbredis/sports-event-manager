import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listSystemAdmins, grantSystemAdminRole, revokeSystemAdminRole } from './system-admins'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log-audit-event'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/audit/log-audit-event', () => ({
  logAuditEvent: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'range']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listSystemAdmins', () => {
  function mockService(rows: unknown, users: Record<string, unknown>) {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn(() => chain({ data: rows, error: null })),
      auth: {
        admin: {
          getUserById: vi.fn((id: string) =>
            Promise.resolve(
              users[id]
                ? { data: { user: users[id] }, error: null }
                : { data: { user: null }, error: { message: 'not found' } }
            )
          ),
        },
      },
    } as never)
  }

  it('takes name and phone from the auth user, oldest first', async () => {
    mockService(
      [
        { id: 'r1', user_id: 'u1', created_at: '2026-07-01T00:00:00Z' },
        { id: 'r2', user_id: 'u2', created_at: '2026-08-01T00:00:00Z' },
      ],
      {
        u1: { phone: '46703021113', user_metadata: { name: 'Peter' } },
        u2: { phone: '46709356595', user_metadata: {} },
      }
    )

    expect(await listSystemAdmins()).toEqual([
      { userId: 'u1', name: 'Peter', phone: '46703021113', createdAt: '2026-07-01T00:00:00Z' },
      // A system admin created by hand has no name; null, not ''.
      { userId: 'u2', name: null, phone: '46709356595', createdAt: '2026-08-01T00:00:00Z' },
    ])
  })

  it('lists a person holding two system_admin rows once, from their first row', async () => {
    mockService(
      [
        { id: 'r1', user_id: 'u1', created_at: '2026-07-01T00:00:00Z' },
        { id: 'r2', user_id: 'u1', created_at: '2026-09-01T00:00:00Z' },
      ],
      { u1: { phone: '46703021113', user_metadata: { name: 'Peter' } } }
    )

    const admins = await listSystemAdmins()
    expect(admins).toHaveLength(1)
    expect(admins[0].createdAt).toBe('2026-07-01T00:00:00Z')
  })

  it('keeps an admin whose auth lookup fails, with name and phone null', async () => {
    mockService([{ id: 'r1', user_id: 'u1', created_at: '2026-07-01T00:00:00Z' }], {})

    expect(await listSystemAdmins()).toEqual([
      { userId: 'u1', name: null, phone: null, createdAt: '2026-07-01T00:00:00Z' },
    ])
  })
})

describe('grantSystemAdminRole / revokeSystemAdminRole', () => {
  function mockRpc(result: unknown) {
    const rpc = vi.fn(() => Promise.resolve(result))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc } as never)
    return rpc
  }

  it('grants through the RPC and audits it with no tenant', async () => {
    const rpc = mockRpc({ data: { granted: true }, error: null })

    expect(await grantSystemAdminRole('u9', 'actor-1')).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('grant_system_admin', { p_user_id: 'u9' })
    expect(logAuditEvent).toHaveBeenCalledWith({
      tenantId: null,
      actorUserId: 'actor-1',
      actorRole: 'system_admin',
      action: 'system_admin_granted',
      targetType: 'user_role',
      targetId: 'u9',
      detail: {},
    })
  })

  it('does not audit a grant that changed nothing', async () => {
    mockRpc({ data: { granted: false }, error: null })

    expect(await grantSystemAdminRole('u9', 'actor-1')).toEqual({ ok: true })
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('reports a grant error as failed', async () => {
    mockRpc({ data: null, error: { code: '42501', message: 'denied' } })

    expect(await grantSystemAdminRole('u9', 'actor-1')).toEqual({ ok: false, reason: 'failed' })
  })

  it('revokes through the RPC and audits it with no tenant', async () => {
    const rpc = mockRpc({ data: { revoked: true }, error: null })

    expect(await revokeSystemAdminRole('u9', 'actor-1')).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('revoke_system_admin', { p_user_id: 'u9' })
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, action: 'system_admin_revoked', targetId: 'u9' })
    )
  })

  it('reports the last-admin guard as a reason, without auditing', async () => {
    mockRpc({ data: null, error: { code: 'P0001', message: 'last' } })

    expect(await revokeSystemAdminRole('u9', 'actor-1')).toEqual({
      ok: false,
      reason: 'lastAdmin',
    })
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('does not audit a revoke that changed nothing', async () => {
    mockRpc({ data: { revoked: false }, error: null })

    expect(await revokeSystemAdminRole('u9', 'actor-1')).toEqual({ ok: true })
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})

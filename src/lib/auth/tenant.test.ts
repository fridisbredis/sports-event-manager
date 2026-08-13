import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getUserRoles,
  resolvePostLoginRedirect,
  confirmOfficialInvite,
  hasAdminAccessToTenant,
  requireSystemAdmin,
  requireTenantAdmin,
  type UserRoleWithTenant,
} from './tenant'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'or', 'limit', 'is', 'update', 'insert']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockServerClient(user: { id: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never)
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getUserRoles', () => {
  it('maps rows to roles with tenant slugs', async () => {
    const fromMock = vi.fn().mockReturnValueOnce(
      chain({
        data: [
          { role: 'tenant_admin', tenant_id: TENANT_ID, tenants: { slug: 'viadal' } },
          { role: 'official', tenant_id: 'tenant-2', tenants: null },
        ],
        error: null,
      })
    )
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const roles = await getUserRoles('user-1')

    expect(roles).toEqual([
      { role: 'tenant_admin', tenant_id: TENANT_ID, tenantSlug: 'viadal' },
      { role: 'official', tenant_id: 'tenant-2', tenantSlug: '' },
    ])
  })

  it('returns an empty array on a query error', async () => {
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null, error: { message: 'boom' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    expect(await getUserRoles('user-1')).toEqual([])
  })

  it('returns an empty array when there is no data', async () => {
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null, error: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    expect(await getUserRoles('user-1')).toEqual([])
  })
})

describe('resolvePostLoginRedirect', () => {
  it('returns null when the user has no roles', () => {
    expect(resolvePostLoginRedirect([])).toBeNull()
  })

  it.each<[UserRoleWithTenant['role'], string]>([
    ['system_admin', '/admin'],
    ['tenant_admin', '/viadal/admin/dashboard'],
    ['official', '/viadal/home'],
    ['participant', '/viadal/participant'],
  ])('routes a single %s role to %s', (role, expected) => {
    const roles: UserRoleWithTenant[] = [{ role, tenant_id: TENANT_ID, tenantSlug: 'viadal' }]
    expect(resolvePostLoginRedirect(roles)).toBe(expected)
  })

  it('picks the highest-priority role when the user has several', () => {
    const roles: UserRoleWithTenant[] = [
      { role: 'official', tenant_id: 'tenant-2', tenantSlug: 'other' },
      { role: 'tenant_admin', tenant_id: TENANT_ID, tenantSlug: 'viadal' },
      { role: 'participant', tenant_id: 'tenant-3', tenantSlug: 'third' },
    ]
    expect(resolvePostLoginRedirect(roles)).toBe('/viadal/admin/dashboard')
  })

  it('prefers system_admin over tenant_admin regardless of array order', () => {
    const roles: UserRoleWithTenant[] = [
      { role: 'tenant_admin', tenant_id: TENANT_ID, tenantSlug: 'viadal' },
      { role: 'system_admin', tenant_id: 'sys', tenantSlug: '' },
    ]
    expect(resolvePostLoginRedirect(roles)).toBe('/admin')
  })
})

describe('confirmOfficialInvite', () => {
  function mockServiceClientWithRpc({
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

  it('returns null when the RPC reports no matching invited official', async () => {
    const { rpc } = mockServiceClientWithRpc({
      rpcResult: { data: null, error: { message: 'not_found' } },
    })

    expect(await confirmOfficialInvite('user-1', '0701234567')).toBeNull()
    expect(rpc).toHaveBeenCalledWith('confirm_official_invite_by_phone', {
      p_user_id: 'user-1',
      p_user_phone: '0701234567',
    })
  })

  it('returns null when the RPC reports the invite as already confirmed (concurrent attempt)', async () => {
    // Simulates the loser of the row lock in confirm_official_invite_by_phone: a second,
    // concurrent login for the same invited phone arrives after the first has already
    // flipped invite_status to 'confirmed'.
    mockServiceClientWithRpc({ rpcResult: { data: null, error: { message: 'already_confirmed' } } })

    expect(await confirmOfficialInvite('user-2', '0701234567')).toBeNull()
  })

  it('returns null and does not confirm when the tenant lookup finds no slug', async () => {
    mockServiceClientWithRpc({
      rpcResult: { data: { tenant_id: TENANT_ID }, error: null },
      tenantResult: { data: null },
    })

    expect(await confirmOfficialInvite('user-1', '0701234567')).toBeNull()
  })

  it('confirms the official via RPC, assigns the role, and returns the tenant slug', async () => {
    const { rpc } = mockServiceClientWithRpc({
      rpcResult: { data: { tenant_id: TENANT_ID }, error: null },
      tenantResult: { data: { slug: 'viadal' } },
    })

    const tenantSlug = await confirmOfficialInvite('user-1', '0701234567')

    expect(tenantSlug).toBe('viadal')
    expect(rpc).toHaveBeenCalledWith('confirm_official_invite_by_phone', {
      p_user_id: 'user-1',
      p_user_phone: '0701234567',
    })
  })
})

describe('hasAdminAccessToTenant', () => {
  it('returns true when a matching role row exists', async () => {
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: { role: 'tenant_admin' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    expect(await hasAdminAccessToTenant('user-1', TENANT_ID)).toBe(true)
  })

  it('returns false when no role row exists', async () => {
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    expect(await hasAdminAccessToTenant('user-1', TENANT_ID)).toBe(false)
  })
})

describe('requireSystemAdmin', () => {
  it('returns a 401 error when there is no authenticated user', async () => {
    mockServerClient(null)

    const result = await requireSystemAdmin()

    expect('error' in result).toBe(true)
    expect((result as { error: { status: number } }).error.status).toBe(401)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('returns a 403 error when the user has no system_admin role row', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await requireSystemAdmin()

    expect((result as { error: { status: number } }).error.status).toBe(403)
  })

  it('returns the user when a system_admin role row exists', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: { role: 'system_admin' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await requireSystemAdmin()

    expect(result).toEqual({ user: { id: 'user-1' } })
  })
})

describe('requireTenantAdmin', () => {
  it('returns a 401 error when there is no authenticated user', async () => {
    mockServerClient(null)

    const result = await requireTenantAdmin(TENANT_ID)

    expect((result as { error: { status: number } }).error.status).toBe(401)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('returns a 500 error when the role lookup fails', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null, error: { message: 'boom' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await requireTenantAdmin(TENANT_ID)

    expect((result as { error: { status: number } }).error.status).toBe(500)
  })

  it('returns a 403 error when the user has no admin role rows at all', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: [], error: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await requireTenantAdmin(TENANT_ID)

    expect((result as { error: { status: number } }).error.status).toBe(403)
  })

  it('returns the tenant-specific role when the user is tenant_admin for this tenant', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ role: 'tenant_admin', tenant_id: TENANT_ID }], error: null })
      )
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await requireTenantAdmin(TENANT_ID)

    expect(result).toEqual({ user: { id: 'user-1' }, role: 'tenant_admin' })
  })

  it('falls back to the first role row when the user is system_admin without a row for this tenant', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ role: 'system_admin', tenant_id: 'other-tenant' }], error: null })
      )
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await requireTenantAdmin(TENANT_ID)

    expect(result).toEqual({ user: { id: 'user-1' }, role: 'system_admin' })
  })
})

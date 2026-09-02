import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getUserRoles,
  resolvePostLoginRedirect,
  confirmOfficialInvite,
  hasAdminAccessToTenant,
  canViewOfficialSurfaces,
  getConfirmedOfficial,
  requireSystemAdmin,
  requireTenantAdmin,
  resolveTenantForAdmin,
  resolveTenantForOfficial,
  getCurrentUser,
  getAdminTenant,
  getOfficialTenant,
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

// getCurrentUser resolves identity from verified JWT claims (getClaims), while
// requireSystemAdmin/requireTenantAdmin are route-handler guards that still call
// getUser. Both are mocked from the same `user` so a test does not have to know
// which mechanism the code under test happens to use.
function mockServerClient(user: { id: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
      getClaims: vi
        .fn()
        .mockResolvedValue({ data: user ? { claims: { sub: user.id } } : null, error: null }),
    },
  } as never)
}

// hasAdminAccessToTenant, canViewOfficialSurfaces and requireTenantAdmin each
// fetch role rows and tenant status via two independent `.from()` calls
// (Promise.all). This dispatches each call to a canned response keyed by
// table name so both queries can be mocked independently in one setup call.
function mockServiceClientByTable(responses: Record<string, unknown>) {
  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    from: vi.fn((table: string) => chain(responses[table])),
  } as never)
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_TENANT_ID = '22222222-2222-2222-2222-222222222222'

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

// Both predicates below fetch role rows and tenant status via parameterized
// `.eq()` queries only — there is no filter string built from `tenantId`, so
// there is nothing for a crafted value to inject into. Real cross-tenant and
// injection-payload behaviour is proven against live PostgREST in
// tests/integration/tenant-isolation-official-access.test.ts; these unit tests
// cover the TypeScript-side authorization decision over role rows.
describe('hasAdminAccessToTenant', () => {
  it('fails closed when tenantId is not a valid UUID', async () => {
    expect(await hasAdminAccessToTenant('user-1', 'not-a-uuid')).toBe(false)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('fails closed on an injected OR-term tenantId', async () => {
    const maliciousTenantId = `${TENANT_ID}),or(role.not.is.null`
    expect(await hasAdminAccessToTenant('user-1', maliciousTenantId)).toBe(false)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('returns true when the caller has a tenant_admin row for this tenant and it is active', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'tenant_admin', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: true }, error: null },
    })

    expect(await hasAdminAccessToTenant('user-1', TENANT_ID)).toBe(true)
  })

  it('returns false when the tenant_admin row is for a different tenant', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'tenant_admin', tenant_id: OTHER_TENANT_ID }], error: null },
      tenants: { data: { is_active: true }, error: null },
    })

    expect(await hasAdminAccessToTenant('user-1', TENANT_ID)).toBe(false)
  })

  it('denies a tenant_admin when the tenant has been deactivated', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'tenant_admin', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: false }, error: null },
    })

    expect(await hasAdminAccessToTenant('user-1', TENANT_ID)).toBe(false)
  })

  it('allows a global system_admin even when the tenant has been deactivated', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'system_admin', tenant_id: OTHER_TENANT_ID }], error: null },
      tenants: { data: { is_active: false }, error: null },
    })

    expect(await hasAdminAccessToTenant('user-1', TENANT_ID)).toBe(true)
  })

  it('returns false when the caller has no role rows at all', async () => {
    mockServiceClientByTable({
      user_roles: { data: [], error: null },
      tenants: { data: { is_active: true }, error: null },
    })

    expect(await hasAdminAccessToTenant('user-1', TENANT_ID)).toBe(false)
  })

  it('fails closed and logs when the role query errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockServiceClientByTable({
      user_roles: { data: null, error: { message: 'boom' } },
      tenants: { data: { is_active: true }, error: null },
    })

    expect(await hasAdminAccessToTenant('user-1', TENANT_ID)).toBe(false)
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('fails closed and logs when the tenant status query errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'tenant_admin', tenant_id: TENANT_ID }], error: null },
      tenants: { data: null, error: { message: 'boom' } },
    })

    expect(await hasAdminAccessToTenant('user-1', TENANT_ID)).toBe(false)
    expect(consoleSpy).toHaveBeenCalled()
  })
})

describe('canViewOfficialSurfaces', () => {
  it('fails closed when tenantId is not a valid UUID', async () => {
    expect(await canViewOfficialSurfaces('user-1', 'not-a-uuid')).toBe(false)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('fails closed on an injected OR-term tenantId', async () => {
    const maliciousTenantId = `${TENANT_ID}),or(role.not.is.null`
    expect(await canViewOfficialSurfaces('user-1', maliciousTenantId)).toBe(false)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('allows a confirmed official in their own active tenant', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'official', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: true }, error: null },
      officials: { data: { id: 'off-1' }, error: null },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(true)
  })

  // invite_status is filtered in the query rather than compared afterwards, so an
  // official who is only 'invited' (or whose row has since been 'removed') is simply
  // absent from the result set.
  it('denies an official who has not been confirmed yet', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'official', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: true }, error: null },
      officials: { data: null, error: null },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(false)
  })

  // Removal is a soft delete, so a re-invited official holds both a 'removed' row and a
  // 'confirmed' row for one (user_id, tenant_id) — legal under 0020, whose index
  // excludes removed rows. Asking for "the" row would make maybeSingle() error on the
  // pair and this guard would deny a legitimately confirmed official.
  it('asks for a confirmed row and takes the first, so a re-invited official is not locked out', async () => {
    const officialsBuilder = chain({ data: { id: 'off-2' }, error: null })
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'officials') return officialsBuilder
        if (table === 'user_roles') {
          return chain({ data: [{ role: 'official', tenant_id: TENANT_ID }], error: null })
        }
        return chain({ data: { is_active: true }, error: null })
      }),
    } as never)

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(true)
    expect(officialsBuilder.eq).toHaveBeenCalledWith('invite_status', 'confirmed')
    expect(officialsBuilder.limit).toHaveBeenCalledWith(1)
  })

  // getConfirmedOfficial exists so MYSCH-01 can reuse the row this guard
  // resolves instead of fetching it a second time (PERF-01). The guard's
  // behaviour is covered above; these cover what the page relies on — that the
  // row itself comes back, and that a failure still reads as "no official"
  // rather than throwing into the page.
  describe('getConfirmedOfficial', () => {
    it('returns the confirmed row so callers can use its id', async () => {
      mockServiceClientByTable({
        officials: { data: { id: 'off-1' }, error: null },
      })

      expect(await getConfirmedOfficial('user-1', TENANT_ID)).toEqual({ id: 'off-1' })
    })

    it('returns null and logs on error, keeping the guard fail-closed', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockServiceClientByTable({
        officials: { data: null, error: { message: 'boom' } },
      })

      expect(await getConfirmedOfficial('user-1', TENANT_ID)).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  it('denies an official role with no matching officials row', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'official', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: true }, error: null },
      officials: { data: null, error: null },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(false)
  })

  it('fails closed and logs when the officials lookup errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'official', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: true }, error: null },
      officials: { data: null, error: { message: 'boom' } },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(false)
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('allows a tenant_admin in their own active tenant', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'tenant_admin', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: true }, error: null },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(true)
  })

  it('denies a participant in their own tenant', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'participant', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: true }, error: null },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(false)
  })

  it('denies an official once the tenant has been deactivated', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'official', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: false }, error: null },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(false)
  })

  it('allows a global system_admin even when the tenant has been deactivated', async () => {
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'system_admin', tenant_id: OTHER_TENANT_ID }], error: null },
      tenants: { data: { is_active: false }, error: null },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(true)
  })

  it('returns false when the caller has no role rows at all', async () => {
    mockServiceClientByTable({
      user_roles: { data: [], error: null },
      tenants: { data: { is_active: true }, error: null },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(false)
  })

  it('fails closed and logs when the role query errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockServiceClientByTable({
      user_roles: { data: null, error: { message: 'boom' } },
      tenants: { data: { is_active: true }, error: null },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(false)
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('fails closed and logs when the tenant status query errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'official', tenant_id: TENANT_ID }], error: null },
      tenants: { data: null, error: { message: 'boom' } },
    })

    expect(await canViewOfficialSurfaces('user-1', TENANT_ID)).toBe(false)
    expect(consoleSpy).toHaveBeenCalled()
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

  it('returns a 500 error and logs when the role query fails', async () => {
    mockServerClient({ id: 'user-1' })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null, error: { message: 'boom' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await requireSystemAdmin()

    expect((result as { error: { status: number } }).error.status).toBe(500)
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('returns a 403 error when the user has no system_admin role row', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: [], error: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await requireSystemAdmin()

    expect((result as { error: { status: number } }).error.status).toBe(403)
  })

  it('returns the user when a single system_admin role row exists', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [{ role: 'system_admin' }], error: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await requireSystemAdmin()

    expect(result).toEqual({ user: { id: 'user-1' } })
  })

  // user_roles is unique per (user_id, tenant_id), not per role, so a
  // system_admin can legally hold a row in more than one tenant.
  it('authorizes a system_admin holding role rows in more than one tenant', async () => {
    mockServerClient({ id: 'user-1' })
    const fromMock = vi.fn().mockReturnValueOnce(
      chain({
        data: [{ role: 'system_admin' }, { role: 'system_admin' }],
        error: null,
      })
    )
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

  it('fails closed with a 403 when tenantId is not a valid UUID', async () => {
    mockServerClient({ id: 'user-1' })

    const result = await requireTenantAdmin('not-a-uuid')

    expect((result as { error: { status: number } }).error.status).toBe(403)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('fails closed with a 403 on an injected OR-term tenantId', async () => {
    mockServerClient({ id: 'user-1' })
    const maliciousTenantId = `${TENANT_ID}),or(role.not.is.null`

    const result = await requireTenantAdmin(maliciousTenantId)

    expect((result as { error: { status: number } }).error.status).toBe(403)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('returns a 500 error and logs when the role lookup fails', async () => {
    mockServerClient({ id: 'user-1' })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockServiceClientByTable({
      user_roles: { data: null, error: { message: 'boom' } },
      tenants: { data: { is_active: true }, error: null },
    })

    const result = await requireTenantAdmin(TENANT_ID)

    expect((result as { error: { status: number } }).error.status).toBe(500)
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('returns a 500 error and logs when the tenant status lookup fails', async () => {
    mockServerClient({ id: 'user-1' })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'tenant_admin', tenant_id: TENANT_ID }], error: null },
      tenants: { data: null, error: { message: 'boom' } },
    })

    const result = await requireTenantAdmin(TENANT_ID)

    expect((result as { error: { status: number } }).error.status).toBe(500)
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('returns a 403 error when the user has no admin role rows at all', async () => {
    mockServerClient({ id: 'user-1' })
    mockServiceClientByTable({
      user_roles: { data: [], error: null },
      tenants: { data: { is_active: true }, error: null },
    })

    const result = await requireTenantAdmin(TENANT_ID)

    expect((result as { error: { status: number } }).error.status).toBe(403)
  })

  it('returns a 403 error when the tenant_admin row is for this tenant but the tenant is inactive', async () => {
    mockServerClient({ id: 'user-1' })
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'tenant_admin', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: false }, error: null },
    })

    const result = await requireTenantAdmin(TENANT_ID)

    expect((result as { error: { status: number } }).error.status).toBe(403)
  })

  it('returns the tenant-specific role when the user is tenant_admin for this active tenant', async () => {
    mockServerClient({ id: 'user-1' })
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'tenant_admin', tenant_id: TENANT_ID }], error: null },
      tenants: { data: { is_active: true }, error: null },
    })

    const result = await requireTenantAdmin(TENANT_ID)

    expect(result).toEqual({ user: { id: 'user-1' }, role: 'tenant_admin' })
  })

  it('authorizes a global system_admin without a row for this tenant, even if the tenant is inactive', async () => {
    mockServerClient({ id: 'user-1' })
    mockServiceClientByTable({
      user_roles: { data: [{ role: 'system_admin', tenant_id: OTHER_TENANT_ID }], error: null },
      tenants: { data: { is_active: false }, error: null },
    })

    const result = await requireTenantAdmin(TENANT_ID)

    expect(result).toEqual({ user: { id: 'user-1' }, role: 'system_admin' })
  })
})

describe('resolveTenantForAdmin', () => {
  it('returns null when no tenant matches the slug', async () => {
    mockServiceClientByTable({ tenants: { data: null, error: null } })

    expect(await resolveTenantForAdmin('viadal', 'user-1')).toBeNull()
  })

  it('returns null when the caller fails the admin access check', async () => {
    mockServiceClientByTable({
      tenants: { data: { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', is_active: true } },
      user_roles: { data: [], error: null },
    })

    expect(await resolveTenantForAdmin('viadal', 'user-1')).toBeNull()
  })

  it('returns the tenant row when the caller passes the admin access check', async () => {
    mockServiceClientByTable({
      tenants: { data: { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', is_active: true } },
      user_roles: { data: [{ role: 'tenant_admin', tenant_id: TENANT_ID }], error: null },
    })

    expect(await resolveTenantForAdmin('viadal', 'user-1')).toEqual({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'blue',
      is_active: true,
    })
  })
})

describe('resolveTenantForOfficial', () => {
  it('returns null when no tenant matches the slug', async () => {
    mockServiceClientByTable({ tenants: { data: null, error: null } })

    expect(await resolveTenantForOfficial('viadal', 'user-1')).toBeNull()
  })

  it('returns null when the caller fails the official surfaces check', async () => {
    mockServiceClientByTable({
      tenants: { data: { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', is_active: true } },
      user_roles: { data: [{ role: 'participant', tenant_id: TENANT_ID }], error: null },
    })

    expect(await resolveTenantForOfficial('viadal', 'user-1')).toBeNull()
  })

  it('returns the tenant row when the caller passes the official surfaces check', async () => {
    mockServiceClientByTable({
      tenants: { data: { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', is_active: true } },
      user_roles: { data: [{ role: 'official', tenant_id: TENANT_ID }], error: null },
      officials: { data: { invite_status: 'confirmed' }, error: null },
    })

    expect(await resolveTenantForOfficial('viadal', 'user-1')).toEqual({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'blue',
      is_active: true,
    })
  })
})

// F-PERF-07's request-scoped memoisation exports. cache() is a no-op outside
// a real React render (confirmed: plain `react` resolves to the identity
// passthrough, not the react-server build Next.js uses), so these tests
// exercise the same authorization logic as resolveTenantForAdmin /
// resolveTenantForOfficial above on every call — they do not, and cannot,
// verify the memoisation itself. What they do verify is that the access
// check still actually runs through these exports, so a future edit can't
// silently drop the gate without a call-site mock papering over it.
describe('getCurrentUser', () => {
  it('returns null when there is no session', async () => {
    mockServerClient(null)

    expect(await getCurrentUser()).toBeNull()
  })

  // Identity comes from the verified `sub` claim. Assert on id rather than the
  // whole object: the rest of the User shape is filled from claims for type
  // compatibility, and no caller reads it — pinning it here would break on any
  // future claim change without protecting anything.
  it('returns the user identified by the verified sub claim', async () => {
    mockServerClient({ id: 'user-1' })

    expect((await getCurrentUser())?.id).toBe('user-1')
  })

  it('returns null when the claims cannot be verified', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: null, error: { message: 'bad signature' } }),
      },
    } as never)

    expect(await getCurrentUser()).toBeNull()
  })

  // getClaims() can throw a plain Error instead of returning { error } — a
  // token whose segments are valid base64url but decode to non-JSON makes
  // JSON.parse throw, and isAuthError() doesn't recognise that as an
  // AuthError, so the SDK rethrows it. An unparseable cookie (a forged token,
  // or a truncated @supabase/ssr chunk) must resolve to null so every caller's
  // existing `if (!user) redirect('/login')` guard is reached, not crash the
  // server component.
  it('returns null when getClaims throws instead of returning an error', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockRejectedValue(new Error('Invalid UTF-8 sequence')),
      },
    } as never)

    expect(await getCurrentUser()).toBeNull()
  })
})

describe('getAdminTenant', () => {
  it('returns null when there is no authenticated user', async () => {
    mockServerClient(null)

    expect(await getAdminTenant('viadal')).toBeNull()
  })

  it('returns null when the caller fails the admin access check', async () => {
    mockServerClient({ id: 'user-1' })
    mockServiceClientByTable({
      tenants: { data: { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', is_active: true } },
      user_roles: { data: [], error: null },
    })

    expect(await getAdminTenant('viadal')).toBeNull()
  })

  it('returns null when no tenant matches the slug', async () => {
    mockServerClient({ id: 'user-1' })
    mockServiceClientByTable({ tenants: { data: null, error: null } })

    expect(await getAdminTenant('viadal')).toBeNull()
  })

  it('returns the tenant row when the caller passes the admin access check', async () => {
    mockServerClient({ id: 'user-1' })
    mockServiceClientByTable({
      tenants: { data: { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', is_active: true } },
      user_roles: { data: [{ role: 'tenant_admin', tenant_id: TENANT_ID }], error: null },
    })

    expect(await getAdminTenant('viadal')).toEqual({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'blue',
      is_active: true,
    })
  })
})

describe('getOfficialTenant', () => {
  it('returns null when there is no authenticated user', async () => {
    mockServerClient(null)

    expect(await getOfficialTenant('viadal')).toBeNull()
  })

  it('returns null when the caller fails the official surfaces check', async () => {
    mockServerClient({ id: 'user-1' })
    mockServiceClientByTable({
      tenants: { data: { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', is_active: true } },
      user_roles: { data: [{ role: 'participant', tenant_id: TENANT_ID }], error: null },
    })

    expect(await getOfficialTenant('viadal')).toBeNull()
  })

  it('returns null when no tenant matches the slug', async () => {
    mockServerClient({ id: 'user-1' })
    mockServiceClientByTable({ tenants: { data: null, error: null } })

    expect(await getOfficialTenant('viadal')).toBeNull()
  })

  it('returns the tenant row when the caller passes the official surfaces check', async () => {
    mockServerClient({ id: 'user-1' })
    mockServiceClientByTable({
      tenants: { data: { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', is_active: true } },
      user_roles: { data: [{ role: 'official', tenant_id: TENANT_ID }], error: null },
      officials: { data: { invite_status: 'confirmed' }, error: null },
    })

    expect(await getOfficialTenant('viadal')).toEqual({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'blue',
      is_active: true,
    })
  })
})

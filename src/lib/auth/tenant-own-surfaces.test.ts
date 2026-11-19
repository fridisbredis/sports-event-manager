import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOwnTenantSurfaces, hasSystemAdminScreens } from './tenant'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { isAdminWithinCap } from '@/lib/auth/tenant-admins'

// B19. Kept out of tenant.test.ts because hasAdminScreens reaches the tier cap
// in tenant-admins, which that file exercises for real; here it is mocked so
// each case can say "within the cap" without modelling the cap's queries.

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant-admins', () => ({
  isAdminWithinCap: vi.fn(async () => true),
}))

vi.mock('@/lib/audit/log-auth-event', () => ({ logAuthEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

type Tenant = { id: string; slug: string; name: string; is_active: boolean; tier: string }
type RoleRow = { role: string; tenant_id: string | null; tenants: { slug: string } | null }

function mockUser(id: string | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getClaims: vi
        .fn()
        .mockResolvedValue({ data: id ? { claims: { sub: id } } : null, error: null }),
    },
  } as never)
}

// One builder per .from(): records eq/in filters, then answers a list read
// (awaited directly) or a single-row read (maybeSingle) from the fixtures.
function mockDb({
  roles,
  tenants,
  confirmedOfficialIn = [],
  tenantsListError = null,
}: {
  roles: RoleRow[]
  tenants: Tenant[]
  confirmedOfficialIn?: string[]
  tenantsListError?: unknown
}) {
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {}
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'limit', 'order']) b[m] = vi.fn(() => b)
    b.eq = vi.fn((col: string, val: unknown) => {
      filters[col] = val
      return b
    })
    b.in = vi.fn((col: string, val: unknown) => {
      filters[col] = val
      return b
    })
    const list = () => {
      if (table === 'user_roles') return { data: roles, error: null }
      if (table === 'tenants') {
        if (tenantsListError) return { data: null, error: tenantsListError }
        const slugs = filters.slug as string[]
        return { data: tenants.filter((t) => slugs.includes(t.slug)), error: null }
      }
      return { data: [], error: null }
    }
    const single = () => {
      if (table === 'tenants') {
        const t = tenants.find((x) => x.slug === filters.slug || x.id === filters.id)
        return { data: t ?? null, error: null }
      }
      if (table === 'officials') {
        const ok = confirmedOfficialIn.includes(filters.tenant_id as string)
        return { data: ok ? { id: `off-${filters.tenant_id}` } : null, error: null }
      }
      return { data: null, error: null }
    }
    b.maybeSingle = vi.fn(() => Promise.resolve(single()))
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(list()).then(res, rej)
    return b
  })
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never)
  return from
}

const SYSTEM: RoleRow = { role: 'system_admin', tenant_id: null, tenants: null }
const tenantA: Tenant = {
  id: A,
  slug: 'viadal',
  name: 'Viadal',
  is_active: true,
  tier: 'professional',
}
const tenantB: Tenant = {
  id: B,
  slug: 'alpha',
  name: 'Alpha IK',
  is_active: true,
  tier: 'professional',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isAdminWithinCap).mockResolvedValue(true)
})

describe('getOwnTenantSurfaces', () => {
  it('returns nothing without a signed-in user', async () => {
    mockUser(null)
    mockDb({ roles: [], tenants: [] })
    expect(await getOwnTenantSurfaces()).toEqual([])
  })

  it('gives a system admin with no tenant roles no tenants at all (ADR-0004)', async () => {
    mockUser('u1')
    const from = mockDb({ roles: [SYSTEM], tenants: [tenantA] })

    expect(await getOwnTenantSurfaces()).toEqual([])
    // Not even the names are read: nothing about a tenant reaches the page.
    expect(from).not.toHaveBeenCalledWith('tenants')
  })

  it('offers the official view where the user has their own confirmed officials row', async () => {
    mockUser('u1')
    mockDb({
      roles: [SYSTEM, { role: 'official', tenant_id: A, tenants: { slug: 'viadal' } }],
      tenants: [tenantA],
      confirmedOfficialIn: [A],
    })

    expect(await getOwnTenantSurfaces()).toEqual([
      { slug: 'viadal', name: 'Viadal', admin: false, official: true },
    ])
  })

  it('does not let system_admin stand in for the officials row', async () => {
    // resolveOfficialSurfaceAccess lets any system_admin through; this list
    // must not, or a system admin would get a way into a tenant by role alone.
    mockUser('u1')
    mockDb({
      roles: [SYSTEM, { role: 'official', tenant_id: A, tenants: { slug: 'viadal' } }],
      tenants: [tenantA],
      confirmedOfficialIn: [],
    })

    expect(await getOwnTenantSurfaces()).toEqual([])
  })

  it('offers the admin view where the user is tenant admin themselves', async () => {
    mockUser('u1')
    mockDb({
      roles: [SYSTEM, { role: 'tenant_admin', tenant_id: A, tenants: { slug: 'viadal' } }],
      tenants: [tenantA],
      confirmedOfficialIn: [A],
    })

    expect(await getOwnTenantSurfaces()).toEqual([
      { slug: 'viadal', name: 'Viadal', admin: true, official: true },
    ])
  })

  it('leaves out a suspended tenant, as for any other admin or official', async () => {
    mockUser('u1')
    mockDb({
      roles: [SYSTEM, { role: 'tenant_admin', tenant_id: A, tenants: { slug: 'viadal' } }],
      tenants: [{ ...tenantA, is_active: false }],
      confirmedOfficialIn: [A],
    })

    expect(await getOwnTenantSurfaces()).toEqual([])
  })

  it('leaves out an admin row past the tier cap', async () => {
    vi.mocked(isAdminWithinCap).mockResolvedValue(false)
    mockUser('u1')
    mockDb({
      roles: [{ role: 'tenant_admin', tenant_id: A, tenants: { slug: 'viadal' } }],
      tenants: [tenantA],
    })

    expect(await getOwnTenantSurfaces()).toEqual([])
  })

  it('lists several tenants by name', async () => {
    mockUser('u1')
    mockDb({
      roles: [
        SYSTEM,
        { role: 'tenant_admin', tenant_id: A, tenants: { slug: 'viadal' } },
        { role: 'official', tenant_id: B, tenants: { slug: 'alpha' } },
      ],
      tenants: [tenantA, tenantB],
      confirmedOfficialIn: [B],
    })

    expect((await getOwnTenantSurfaces()).map((s) => s.name)).toEqual(['Alpha IK', 'Viadal'])
  })

  it('offers no links when the tenant names cannot be read', async () => {
    mockUser('u1')
    mockDb({
      roles: [{ role: 'official', tenant_id: A, tenants: { slug: 'viadal' } }],
      tenants: [tenantA],
      tenantsListError: { message: 'boom' },
    })

    expect(await getOwnTenantSurfaces()).toEqual([])
  })
})

describe('hasSystemAdminScreens', () => {
  it('is true for a user holding system_admin', async () => {
    mockUser('u1')
    mockDb({ roles: [SYSTEM], tenants: [] })
    expect(await hasSystemAdminScreens()).toBe(true)
  })

  it('is false for a tenant admin without system_admin', async () => {
    mockUser('u1')
    mockDb({
      roles: [{ role: 'tenant_admin', tenant_id: A, tenants: { slug: 'viadal' } }],
      tenants: [],
    })
    expect(await hasSystemAdminScreens()).toBe(false)
  })

  it('is false without a signed-in user', async () => {
    mockUser(null)
    mockDb({ roles: [], tenants: [] })
    expect(await hasSystemAdminScreens()).toBe(false)
  })
})

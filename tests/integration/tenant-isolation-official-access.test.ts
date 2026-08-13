import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  canViewOfficialSurfaces,
  hasAdminAccessToTenant,
  requireSystemAdmin,
  type TenantRole,
} from '@/lib/auth/tenant'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createTenant, createUserWithRole, serviceClient, cleanupTenant } from './helpers'

// Only the auth boundary (which user is "logged in") is mocked here — there is
// no Next.js request scope in this harness, so `createSupabaseServerClient`'s
// `cookies()` call has nothing to read. `createSupabaseServiceClient` is left
// untouched via `importOriginal`, so every role-row query in this file still
// hits the real local Postgrest instance.
vi.mock('@/lib/supabase/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/server')>()
  return {
    ...actual,
    createSupabaseServerClient: vi.fn(),
  }
})

function mockAuthenticatedUser(userId: string) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
  } as never)
}

// Local helper: give an already-created user an additional role row in
// another tenant, without creating a second auth user. user_roles is
// `unique (user_id, tenant_id)` — unique per tenant, not per role — so this
// is a legal state, e.g. a system_admin holding a row in two tenants, or a
// participant in one tenant who is also a tenant_admin in another.
async function addRoleInTenant(userId: string, tenantId: string, role: TenantRole) {
  const admin = serviceClient()
  const { error } = await admin
    .from('user_roles')
    .insert({ user_id: userId, tenant_id: tenantId, role })
  if (error) throw error
}

// SEC-02: the (official)/[tenantSlug] layout is the sole gate for every official
// screen, so its predicate is what keeps one tenant's officials out of another's.
// The unit tests in src/lib/auth/tenant.test.ts can only assert that the filter
// string was built as written — a mock never evaluates it. These run the real
// query against live PostgREST, which is the only place the `.or()` conjunction
// is actually proven.
describe('SEC-02: canViewOfficialSurfaces tenant isolation', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }

  let officialA: string
  let participantA: string
  let adminA: string
  let systemAdminInB: string
  let participantAOfficialB: string

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A Official Access')
    tenantB = await createTenant('Tenant B Official Access')

    officialA = (await createUserWithRole(tenantA.id, 'official')).userId
    participantA = (await createUserWithRole(tenantA.id, 'participant')).userId
    adminA = (await createUserWithRole(tenantA.id, 'tenant_admin')).userId

    // user_roles.tenant_id is NOT NULL, so a system_admin always sits in some
    // tenant. This one is anchored in B precisely so its access to A proves the
    // global bypass rather than a per-tenant row.
    systemAdminInB = (await createUserWithRole(tenantB.id, 'system_admin')).userId

    // Multi-tenant user: participant in A, official in B. The `.or()` filter does
    // a per-row conjunction; if the parentheses are wrong, the official row in B
    // satisfies the role list while the tenant match comes from the A row, and
    // this user wrongly passes for tenant A.
    participantAOfficialB = (await createUserWithRole(tenantA.id, 'participant')).userId
    await addRoleInTenant(participantAOfficialB, tenantB.id, 'official')
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  it('allows an official in their own tenant', async () => {
    expect(await canViewOfficialSurfaces(officialA, tenantA.id)).toBe(true)
  })

  it('denies an official from another tenant', async () => {
    expect(await canViewOfficialSurfaces(officialA, tenantB.id)).toBe(false)
  })

  it('denies a participant in their own tenant', async () => {
    expect(await canViewOfficialSurfaces(participantA, tenantA.id)).toBe(false)
  })

  it('allows a tenant admin in their own tenant', async () => {
    expect(await canViewOfficialSurfaces(adminA, tenantA.id)).toBe(true)
  })

  it('allows a system admin in a tenant where they hold no role row', async () => {
    expect(await canViewOfficialSurfaces(systemAdminInB, tenantA.id)).toBe(true)
  })

  it('allows a system admin in their own tenant', async () => {
    expect(await canViewOfficialSurfaces(systemAdminInB, tenantB.id)).toBe(true)
  })

  it('denies a user whose official role is in a different tenant than the one requested', async () => {
    expect(await canViewOfficialSurfaces(participantAOfficialB, tenantA.id)).toBe(false)
    expect(await canViewOfficialSurfaces(participantAOfficialB, tenantB.id)).toBe(true)
  })

  it('denies a user with no role rows at all', async () => {
    expect(await canViewOfficialSurfaces('00000000-0000-0000-0000-000000000000', tenantA.id)).toBe(
      false
    )
  })

  // `hasAdminAccessToTenant` and `canViewOfficialSurfaces` build the `.or()`
  // filter by raw string interpolation of `tenantId`, with no escaping.
  // supabase-js sends it to PostgREST verbatim, so a crafted `tenantId` can
  // restructure the OR tree. participantA's own row (role: participant, own
  // tenant) is what the injected `role.not.is.null` term latches onto — the
  // query already scopes `.eq('user_id', ...)` to the caller, which is exactly
  // what makes any of the caller's own rows exploitable this way.
  it("does not let an injected OR term in tenantId manufacture a role match from the caller's own row", async () => {
    const maliciousTenantId = `${tenantA.id}),or(role.not.is.null`
    expect(await canViewOfficialSurfaces(participantA, maliciousTenantId)).toBe(false)
  })

  it('fails closed when tenantId is not a well-formed identifier at all', async () => {
    expect(await canViewOfficialSurfaces(participantA, 'not-a-real-tenant-id')).toBe(false)
  })
})

// SEC-02: hasAdminAccessToTenant gates every admin page (9 screens) and is
// strictly higher-privilege than canViewOfficialSurfaces — an official passing
// this check would reach tenant-admin-only surfaces. It shares the exact same
// unescaped `.or()` string-interpolation pattern, so it needs the same live
// coverage, not just the mocked unit test that can only assert the string was
// built as written.
describe('SEC-02: hasAdminAccessToTenant tenant isolation', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }

  let officialA: string
  let participantA: string
  let adminA: string
  let adminB: string
  let systemAdminInB: string
  let participantAAdminB: string

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A Admin Access')
    tenantB = await createTenant('Tenant B Admin Access')

    officialA = (await createUserWithRole(tenantA.id, 'official')).userId
    participantA = (await createUserWithRole(tenantA.id, 'participant')).userId
    adminA = (await createUserWithRole(tenantA.id, 'tenant_admin')).userId
    adminB = (await createUserWithRole(tenantB.id, 'tenant_admin')).userId

    // user_roles.tenant_id is NOT NULL, so a system_admin always sits in some
    // tenant. This one is anchored in B precisely so its access to A proves the
    // global bypass rather than a per-tenant row.
    systemAdminInB = (await createUserWithRole(tenantB.id, 'system_admin')).userId

    // Multi-tenant user: participant in A, tenant_admin in B. If the `.or()`
    // parentheses are wrong, the admin role row in B could satisfy the role
    // list while the tenant match comes from the A row, wrongly granting
    // admin access to tenant A.
    participantAAdminB = (await createUserWithRole(tenantA.id, 'participant')).userId
    await addRoleInTenant(participantAAdminB, tenantB.id, 'tenant_admin')
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  // The meaningful difference from canViewOfficialSurfaces: officials must not
  // reach admin-only surfaces, in their own tenant or anyone else's.
  it('denies an official in their own tenant', async () => {
    expect(await hasAdminAccessToTenant(officialA, tenantA.id)).toBe(false)
  })

  it('denies an official from another tenant', async () => {
    expect(await hasAdminAccessToTenant(officialA, tenantB.id)).toBe(false)
  })

  it('denies a participant in their own tenant', async () => {
    expect(await hasAdminAccessToTenant(participantA, tenantA.id)).toBe(false)
  })

  it('allows a tenant admin in their own tenant', async () => {
    expect(await hasAdminAccessToTenant(adminA, tenantA.id)).toBe(true)
  })

  it('denies a tenant admin from another tenant', async () => {
    expect(await hasAdminAccessToTenant(adminB, tenantA.id)).toBe(false)
  })

  it('allows a system admin in a tenant where they hold no role row', async () => {
    expect(await hasAdminAccessToTenant(systemAdminInB, tenantA.id)).toBe(true)
  })

  it('allows a system admin in their own tenant', async () => {
    expect(await hasAdminAccessToTenant(systemAdminInB, tenantB.id)).toBe(true)
  })

  it('denies a user whose admin role is in a different tenant than the one requested', async () => {
    expect(await hasAdminAccessToTenant(participantAAdminB, tenantA.id)).toBe(false)
    expect(await hasAdminAccessToTenant(participantAAdminB, tenantB.id)).toBe(true)
  })

  it('denies a user with no role rows at all', async () => {
    expect(await hasAdminAccessToTenant('00000000-0000-0000-0000-000000000000', tenantA.id)).toBe(
      false
    )
  })

  // Same injection shape as canViewOfficialSurfaces, mirrored here because
  // hasAdminAccessToTenant gates strictly more (9 admin pages vs. the official
  // surfaces). officialA legitimately has no admin rights in tenantA — the
  // injected `role.not.is.null` term is what turns officialA's own official
  // row into a false admin match.
  it("does not let an injected OR term in tenantId manufacture an admin match from the caller's own row", async () => {
    const maliciousTenantId = `${tenantA.id}),or(role.not.is.null`
    expect(await hasAdminAccessToTenant(officialA, maliciousTenantId)).toBe(false)
  })

  it('fails closed when tenantId is not a well-formed identifier at all', async () => {
    expect(await hasAdminAccessToTenant(officialA, 'not-a-real-tenant-id')).toBe(false)
  })
})

// SEC-02 (adjacent bug): user_roles is `unique (user_id, tenant_id)` — unique
// per tenant, not per role — so one user can legally hold a system_admin row
// in two tenants at once. requireSystemAdmin's lookup never got the .limit(1)
// its siblings (hasAdminAccessToTenant, canViewOfficialSurfaces) have, and it
// discards the query's `error`. With 2+ matching rows, .maybeSingle() returns
// a PGRST116 error and null data, so a legitimate system admin gets 403'd on
// every system-admin surface. A mocked query builder that returns a single
// canned row can never reproduce this — it takes a real query against live
// PostgREST returning more than one row.
describe('SEC-02: requireSystemAdmin with role rows in multiple tenants', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let systemAdminInBothTenants: string

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A System Admin Rows')
    tenantB = await createTenant('Tenant B System Admin Rows')

    systemAdminInBothTenants = (await createUserWithRole(tenantA.id, 'system_admin')).userId
    await addRoleInTenant(systemAdminInBothTenants, tenantB.id, 'system_admin')
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  it('authorises a system admin holding a role row in more than one tenant', async () => {
    mockAuthenticatedUser(systemAdminInBothTenants)

    const result = await requireSystemAdmin()

    expect('error' in result).toBe(false)
    expect((result as { user: { id: string } }).user.id).toBe(systemAdminInBothTenants)
  })
})

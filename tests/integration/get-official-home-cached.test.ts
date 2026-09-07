import { describe, it, expect, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  createOfficialLinkedToUser,
  cleanupTenant,
  signInAsClient,
} from './helpers'

// PERF-06 / F-PERF-04 Phase 1 (ADR-0003): get_official_home_cached (migration
// 0050) is the pilot for the caching design's fail-closed claim — a
// SECURITY DEFINER RPC owned by cache_rpc_reader (NOBYPASSRLS, migration
// 0049), called only via the service-role client from inside unstable_cache.
// This exercises the real function against real Postgres, not a mocked
// return value — matching the project convention that RPC replace/rewrite
// migrations need an integration test asserting the exact response shape
// and access boundary, not just that the call succeeds.
//
// HOME-01's shape is narrower than the ADR's Group 1 examples: an "own-row
// filter" (tenant_id AND user_id), not tenant-only. The cross-tenant tests
// below prove the tenant boundary; the cross-user tests prove the boundary
// the ADR itself flagged as untested when it only verified the tenant-only
// case.

function callRpc(client: SupabaseClient<Database>, tenantId: string, userId: string) {
  return client.rpc('get_official_home_cached', {
    p_tenant_id: tenantId,
    p_user_id: userId,
  })
}

describe('get_official_home_cached RPC (PERF-06 Phase 1 fail-closed boundary)', () => {
  const createdTenantIds: string[] = []

  afterAll(async () => {
    await Promise.all(createdTenantIds.map((id) => cleanupTenant(id)))
  })

  it('returns the confirmed official\'s name for the matching (tenant, user) pair', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Home Cache Happy Path')
    createdTenantIds.push(tenant.id)
    const { userId } = await createUserWithRole(tenant.id, 'official')
    await admin.from('officials').delete().eq('tenant_id', tenant.id).eq('user_id', userId)
    await createOfficialLinkedToUser(tenant.id, userId, 'Home Cache Official', 'confirmed')

    const { data, error } = await callRpc(admin, tenant.id, userId)
    expect(error).toBeNull()
    expect((data as { name: string | null }).name).toBe('Home Cache Official')
  })

  it('returns a null name when the official row is not yet confirmed', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Home Cache Unconfirmed')
    createdTenantIds.push(tenant.id)
    const { userId } = await createUserWithRole(tenant.id, 'official')
    await admin.from('officials').delete().eq('tenant_id', tenant.id).eq('user_id', userId)
    await createOfficialLinkedToUser(tenant.id, userId, 'Not Yet Confirmed', 'invited')

    const { data, error } = await callRpc(admin, tenant.id, userId)
    expect(error).toBeNull()
    expect((data as { name: string | null }).name).toBeNull()
  })

  it('does not leak another tenant\'s row when called with the wrong tenant_id for a real user_id', async () => {
    const admin = serviceClient()
    const tenantA = await createTenant('PERF-06 Home Cache Tenant A')
    const tenantB = await createTenant('PERF-06 Home Cache Tenant B')
    createdTenantIds.push(tenantA.id, tenantB.id)
    const { userId } = await createUserWithRole(tenantA.id, 'official')
    await admin.from('officials').delete().eq('tenant_id', tenantA.id).eq('user_id', userId)
    await createOfficialLinkedToUser(tenantA.id, userId, 'Tenant A Official', 'confirmed')

    // Same user_id, but tenant B's id — RLS must judge this against tenant
    // B's rows (none), not tenant A's, even though the officials row for
    // this user_id genuinely exists.
    const { data, error } = await callRpc(admin, tenantB.id, userId)
    expect(error).toBeNull()
    expect((data as { name: string | null }).name).toBeNull()
  })

  it('does not leak another user\'s row when called with the wrong user_id for the real tenant_id', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Home Cache Own-Row Filter')
    createdTenantIds.push(tenant.id)
    const { userId: userA } = await createUserWithRole(tenant.id, 'official')
    await admin.from('officials').delete().eq('tenant_id', tenant.id).eq('user_id', userA)
    await createOfficialLinkedToUser(tenant.id, userA, 'Official A', 'confirmed')
    const { userId: userB } = await createUserWithRole(tenant.id, 'official')
    await admin.from('officials').delete().eq('tenant_id', tenant.id).eq('user_id', userB)
    await createOfficialLinkedToUser(tenant.id, userB, 'Official B', 'confirmed')

    // The exact case the ADR's tenant-only precedent never exercised: two
    // rows share a tenant_id, so a tenant-only RLS policy would not catch
    // this leak — only the own-row (user_id) half of the policy does.
    const { data: asUserA } = await callRpc(admin, tenant.id, userA)
    expect((asUserA as { name: string | null }).name).toBe('Official A')

    const { data: asUserB } = await callRpc(admin, tenant.id, userB)
    expect((asUserB as { name: string | null }).name).toBe('Official B')
  })

  describe('access control: anon/authenticated must be denied', () => {
    const anon: SupabaseClient<Database> = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    )

    it('denies anon calling the RPC directly', async () => {
      const { error } = await callRpc(
        anon,
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002'
      )
      expect(error).not.toBeNull()
    })

    it('denies an authenticated official calling the RPC directly, even for their own ids', async () => {
      const admin = serviceClient()
      const tenant = await createTenant('PERF-06 Home Cache ACL Authenticated')
      createdTenantIds.push(tenant.id)
      const { userId, phone } = await createUserWithRole(tenant.id, 'official')
      await admin.from('officials').delete().eq('tenant_id', tenant.id).eq('user_id', userId)
      await createOfficialLinkedToUser(tenant.id, userId, 'ACL Official', 'confirmed')

      // A real signed-in session (via local test OTP), not just an anon-key
      // client with no session — this is what actually distinguishes
      // `authenticated` from `anon` at the Postgres role level. The RPC's
      // grant excludes `authenticated` entirely, so this must be denied even
      // though the ids passed are this user's own, not an attempt to read
      // someone else's data. If the grant were ever loosened to
      // `authenticated`, the anon key (shipped to every browser) could call
      // this directly with any tenant_id/user_id pair, RLS notwithstanding,
      // since the policy would then judge the caller's own supplied values
      // as legitimate.
      const authClient = await signInAsClient(phone, '000000')
      const { error } = await callRpc(authClient, tenant.id, userId)
      expect(error).not.toBeNull()
    })
  })
})

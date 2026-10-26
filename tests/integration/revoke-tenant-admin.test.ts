import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { serviceClient, createTenant, createUserWithRole, cleanupTenant } from './helpers'

// N27 / migration 20261026123231. grant_tenant_admin promotes an official by
// overwriting their single (user_id, tenant_id) role row, so the old
// revoke_tenant_admin — which deleted that row — left a demoted admin with a
// confirmed roster row and no role at all, unable to sign in. These run the
// real function body, because the regression they guard is in SQL: a mocked
// RPC would pass whatever the function actually does.
describe('revoke_tenant_admin', () => {
  let tenantId: string

  beforeEach(async () => {
    tenantId = (await createTenant('Revoke Tenant Admin RPC')).id
  })

  afterEach(async () => {
    await cleanupTenant(tenantId)
  })

  async function roleOf(userId: string) {
    const { data, error } = await serviceClient()
      .from('user_roles')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
    if (error) throw error
    return (data ?? []).map((row) => row.role)
  }

  async function grant(userId: string) {
    const { error } = await serviceClient().rpc('grant_tenant_admin', {
      p_tenant_id: tenantId,
      p_user_id: userId,
    })
    if (error) throw error
  }

  async function revoke(userId: string) {
    return serviceClient().rpc('revoke_tenant_admin', {
      p_tenant_id: tenantId,
      p_user_id: userId,
    })
  }

  it('demotes a promoted official back to official instead of deleting their role', async () => {
    await createUserWithRole(tenantId, 'tenant_admin')
    const promoted = await createUserWithRole(tenantId, 'official')
    await grant(promoted.userId)
    expect(await roleOf(promoted.userId)).toEqual(['tenant_admin'])

    const { data, error } = await revoke(promoted.userId)
    expect(error).toBeNull()

    // Exact keys, not just truthiness: revokeTenantAdmin and the N27 helper
    // destructure this jsonb, and gen types cannot see inside it.
    expect(data).toEqual({ revoked: true, demoted: true })
    expect(await roleOf(promoted.userId)).toEqual(['official'])
  })

  it('deletes the role of an admin who has no confirmed roster row', async () => {
    // A hand-inserted admin from before ensure_admin_roster_row existed: a
    // role row and nothing on the roster to fall back to.
    await createUserWithRole(tenantId, 'tenant_admin')
    const legacy = await createUserWithRole(tenantId, 'tenant_admin')

    const { data, error } = await revoke(legacy.userId)
    expect(error).toBeNull()
    expect(data).toEqual({ revoked: true, demoted: false })
    expect(await roleOf(legacy.userId)).toEqual([])
  })

  it('refuses to remove the last admin', async () => {
    const only = await createUserWithRole(tenantId, 'tenant_admin')

    const { error } = await revoke(only.userId)
    expect(error?.code).toBe('P0001')
    expect(await roleOf(only.userId)).toEqual(['tenant_admin'])
  })

  it('is a quiet no-op for someone who is not an admin', async () => {
    // Checked before the last-admin guard, so a stale click on an already
    // demoted person does not surface as "cannot remove the last admin".
    await createUserWithRole(tenantId, 'tenant_admin')
    const official = await createUserWithRole(tenantId, 'official')

    const { data, error } = await revoke(official.userId)
    expect(error).toBeNull()
    expect(data).toEqual({ revoked: false, demoted: false })
    expect(await roleOf(official.userId)).toEqual(['official'])
  })

  it('cannot leave a tenant with no admins when two are revoked at once', async () => {
    const first = await createUserWithRole(tenantId, 'tenant_admin')
    const second = await createUserWithRole(tenantId, 'tenant_admin')

    const results = await Promise.all([revoke(first.userId), revoke(second.userId)])

    // The tenant row lock serialises the two: one succeeds, the other then
    // sees a single admin left and is refused.
    expect(results.filter((r) => r.error === null)).toHaveLength(1)
    expect(results.filter((r) => r.error?.code === 'P0001')).toHaveLength(1)

    const { count, error } = await serviceClient()
      .from('user_roles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role', 'tenant_admin')
    expect(error).toBeNull()
    expect(count).toBe(1)
  })
})

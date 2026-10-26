import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  createSystemAdmin,
  createUserWithoutRole,
  signInAsClient,
  cleanupTenant,
  deleteAuthUser,
} from './helpers'

// N28 / migration 20261026134923. system_admin is global, so the last-admin
// guard counts across the whole database rather than within a tenant. These
// run the real function bodies: the guard, the advisory lock and the grants
// are all in SQL, and a mocked RPC would pass whatever the function does.
describe('grant_system_admin / revoke_system_admin', () => {
  // Every user created here, so afterEach can remove them however a test
  // ended. deleteAuthUser() drops their user_roles rows too.
  let created: string[] = []

  async function track<T extends { userId: string }>(user: Promise<T>): Promise<T> {
    const resolved = await user
    created.push(resolved.userId)
    return resolved
  }

  async function systemAdminIds() {
    const { data, error } = await serviceClient()
      .from('user_roles')
      .select('user_id, tenant_id')
      .eq('role', 'system_admin')
    if (error) throw error
    return data ?? []
  }

  const grant = (userId: string) => serviceClient().rpc('grant_system_admin', { p_user_id: userId })
  const revoke = (userId: string) =>
    serviceClient().rpc('revoke_system_admin', { p_user_id: userId })

  // The guard counts every system admin in the database, so these tests only
  // mean something if they start from none. The local stack usually has one:
  // the E2E global setup and scripts/seed-dev.ts both create the seed system
  // admin. Their rows are set aside for this suite and put back verbatim —
  // same id and created_at — so nothing outside it notices.
  let setAside: Database['public']['Tables']['user_roles']['Row'][] = []

  beforeAll(async () => {
    const service = serviceClient()
    const { data, error } = await service.from('user_roles').select('*').eq('role', 'system_admin')
    if (error) throw error
    setAside = data ?? []

    if (setAside.length > 0) {
      const { error: deleteError } = await service
        .from('user_roles')
        .delete()
        .in(
          'id',
          setAside.map((row) => row.id)
        )
      if (deleteError) throw deleteError
    }
  })

  afterAll(async () => {
    if (setAside.length === 0) return
    const { error } = await serviceClient().from('user_roles').insert(setAside)
    if (error) throw error
  })

  afterEach(async () => {
    for (const userId of created) await deleteAuthUser(userId)
    created = []
  })

  it('grants a global role with no tenant, idempotently', async () => {
    const user = await track(createUserWithoutRole())

    const first = await grant(user.userId)
    expect(first.error).toBeNull()
    // Exact keys: the server helper destructures this jsonb, and gen types
    // cannot see inside it.
    expect(first.data).toEqual({ granted: true })

    const second = await grant(user.userId)
    expect(second.error).toBeNull()
    expect(second.data).toEqual({ granted: false })

    expect(await systemAdminIds()).toEqual([{ user_id: user.userId, tenant_id: null }])
  })

  it('rejects a user id with no auth user', async () => {
    const { error } = await grant('00000000-0000-0000-0000-00000000dead')
    expect(error?.code).toBe('23503')
  })

  it('removes one of two system admins and leaves their tenant role alone', async () => {
    const tenantId = (await createTenant('System Admin Revoke')).id
    try {
      await track(createSystemAdmin())
      // A tenant admin who is also made a system admin: two separate rows.
      const both = await createUserWithRole(tenantId, 'tenant_admin')
      await grant(both.userId)

      const { data, error } = await revoke(both.userId)
      expect(error).toBeNull()
      expect(data).toEqual({ revoked: true })

      const { data: remaining } = await serviceClient()
        .from('user_roles')
        .select('role, tenant_id')
        .eq('user_id', both.userId)
      expect(remaining).toEqual([{ role: 'tenant_admin', tenant_id: tenantId }])
    } finally {
      await cleanupTenant(tenantId)
    }
  })

  it('refuses to remove the last system admin', async () => {
    const only = await track(createSystemAdmin())

    const { error } = await revoke(only.userId)
    expect(error?.code).toBe('P0001')
    expect(await systemAdminIds()).toHaveLength(1)
  })

  it('counts a person with several system_admin rows as one admin, and revokes them all', async () => {
    // 0021 still admits a system_admin row with a real tenant_id (the pre-0021
    // shape), so one person can hold several. They must neither pass the
    // last-admin guard as "two admins" nor keep access through a row the
    // revoke missed.
    const tenantId = (await createTenant('System Admin Legacy Rows')).id
    try {
      const legacy = await track(createSystemAdmin())
      const { error: insertError } = await serviceClient()
        .from('user_roles')
        .insert({ user_id: legacy.userId, tenant_id: tenantId, role: 'system_admin' })
      if (insertError) throw insertError

      const alone = await revoke(legacy.userId)
      expect(alone.error?.code).toBe('P0001')

      // Granting someone who already holds the role, under any tenant_id,
      // adds nothing.
      expect((await grant(legacy.userId)).data).toEqual({ granted: false })

      const other = await track(createSystemAdmin())
      const { data, error } = await revoke(legacy.userId)
      expect(error).toBeNull()
      expect(data).toEqual({ revoked: true })
      expect(await systemAdminIds()).toEqual([{ user_id: other.userId, tenant_id: null }])
    } finally {
      await cleanupTenant(tenantId)
    }
  })

  it('is a quiet no-op for someone who is not a system admin', async () => {
    // Checked before the last-admin guard, so a stale click on an already
    // removed admin does not surface as "cannot remove the last admin".
    await track(createSystemAdmin())
    const other = await track(createUserWithoutRole())

    const { data, error } = await revoke(other.userId)
    expect(error).toBeNull()
    expect(data).toEqual({ revoked: false })
  })

  it('cannot leave the platform with no system admins when two are revoked at once', async () => {
    const first = await track(createSystemAdmin())
    const second = await track(createSystemAdmin())

    const results = await Promise.all([revoke(first.userId), revoke(second.userId)])

    // The advisory lock serialises the two: one succeeds, the other then sees
    // a single admin left and is refused.
    expect(results.filter((r) => r.error === null)).toHaveLength(1)
    expect(results.filter((r) => r.error?.code === 'P0001')).toHaveLength(1)
    expect(await systemAdminIds()).toHaveLength(1)
  })

  it('cannot be called with a user session, even a system admin one', async () => {
    // service_role is the only grantee. A signed-in system admin calling the
    // RPC straight through PostgREST must be refused — otherwise the app's
    // assertSystemAdmin() and self-removal check could be bypassed.
    const admin = await track(createSystemAdmin())
    const target = await track(createUserWithoutRole())
    const client = await signInAsClient(admin.phone, '000000')

    const granted = await client.rpc('grant_system_admin', { p_user_id: target.userId })
    expect(granted.error?.code).toBe('42501')

    const revoked = await client.rpc('revoke_system_admin', { p_user_id: admin.userId })
    expect(revoked.error?.code).toBe('42501')

    expect(await systemAdminIds()).toEqual([{ user_id: admin.userId, tenant_id: null }])
  })
})

describe('audit_events for system admin changes (N28)', () => {
  let tenantId: string
  let systemAdminUserId: string
  let systemAdminPhone: string
  let tenantAdminPhone: string

  beforeAll(async () => {
    tenantId = (await createTenant('System Admin Audit')).id
    tenantAdminPhone = (await createUserWithRole(tenantId, 'tenant_admin')).phone
    const systemAdmin = await createSystemAdmin()
    systemAdminUserId = systemAdmin.userId
    systemAdminPhone = systemAdmin.phone
  })

  afterAll(async () => {
    await serviceClient().from('audit_events').delete().eq('actor_user_id', systemAdminUserId)
    await cleanupTenant(tenantId)
    await deleteAuthUser(systemAdminUserId)
  })

  it('lets a system admin record a tenant-less grant that tenant admins cannot read', async () => {
    const sysClient = await signInAsClient(systemAdminPhone, '000000')

    const { error } = await sysClient.from('audit_events').insert({
      tenant_id: null,
      actor_user_id: systemAdminUserId,
      actor_role: 'system_admin',
      action: 'system_admin_granted',
      target_type: 'user_role',
      target_id: systemAdminUserId,
      detail: {},
    })
    expect(error).toBeNull()

    // A tenant admin's read policy is get_user_role(tenant_id), which is
    // null for a null tenant_id — platform-level events stay out of every
    // tenant's audit view.
    const tenantAdminClient = await signInAsClient(tenantAdminPhone, '000000')
    const { data, error: readError } = await tenantAdminClient
      .from('audit_events')
      .select('id')
      .eq('action', 'system_admin_granted')
    expect(readError).toBeNull()
    expect(data).toEqual([])
  })
})

import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { serviceClient, createTenant, createUserWithRole } from './helpers'

// Migration 0047 changed the user_roles upsert in both confirm_official_invite
// (this file, the invite_token path) and confirm_official_invite_by_phone
// (tests/integration/confirm-official-invite-by-phone.test.ts). The
// phone-fallback file already covers the concurrency guard, the ACL
// boundary, and consent enforcement in depth, all of which are unchanged by
// 0047 in this function too — this file focuses on what 0047 actually
// changed: role_granted correctly reporting a cross-role transition, not
// regressing the idempotent-reconfirm case, and the RPC's response shape.

async function createTokenInvite(tenantId: string, phone: string) {
  const admin = serviceClient()
  const token = randomUUID()
  const { data, error } = await admin
    .from('officials')
    .insert({
      tenant_id: tenantId,
      name: 'Pending Official',
      phone,
      invite_status: 'invited',
      invite_token: token,
      invite_token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return { official: data, token }
}

async function confirmByToken(
  admin: ReturnType<typeof serviceClient>,
  token: string,
  userId: string,
  phone: string,
  name: string,
  privacyAccepted: boolean
) {
  return admin.rpc('confirm_official_invite', {
    p_token: token,
    p_user_id: userId,
    p_user_phone: phone,
    p_name: name,
    p_privacy_accepted: privacyAccepted,
  })
}

describe('confirm_official_invite RPC (migration 0047 role_granted fix)', () => {
  const createdTenantIds: string[] = []
  const createdUserIds: string[] = []

  afterAll(async () => {
    const admin = serviceClient()
    if (createdTenantIds.length > 0) {
      await admin.from('tenants').delete().in('id', createdTenantIds)
    }
    await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)))
  })

  it('grants the official role and reports role_granted=true when the user already has a different role in the tenant', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-07 Token Cross-Role')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    const { token } = await createTokenInvite(tenant.id, phone)

    const { userId } = await createUserWithRole(tenant.id, 'participant')
    createdUserIds.push(userId)

    const { data, error } = await confirmByToken(
      admin,
      token,
      userId,
      phone,
      'Confirmed Name',
      true
    )
    expect(error).toBeNull()
    const result = data as unknown as { tenant_id: string; role_granted: boolean }
    expect(result.role_granted).toBe(true)

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenant.id)
      .single()
    expect(roleRow!.role).toBe('official')
  })

  it('reports role_granted=false when the user is already an official in the tenant (idempotent re-confirm)', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-07 Token Idempotent')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    const { token } = await createTokenInvite(tenant.id, phone)

    const { userId } = await createUserWithRole(tenant.id, 'official')
    createdUserIds.push(userId)

    const { data, error } = await confirmByToken(
      admin,
      token,
      userId,
      phone,
      'Confirmed Name',
      true
    )
    expect(error).toBeNull()
    const result = data as unknown as { tenant_id: string; role_granted: boolean }
    expect(result.role_granted).toBe(false)

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenant.id)
      .single()
    expect(roleRow!.role).toBe('official')
  })

  it('reports role_granted=true when the user has no prior role in the tenant', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-07 Token New Grant')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    const { token } = await createTokenInvite(tenant.id, phone)

    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
    })
    if (userError) throw userError
    createdUserIds.push(userData.user.id)

    const { data, error } = await confirmByToken(
      admin,
      token,
      userData.user.id,
      phone,
      'Confirmed Name',
      true
    )
    expect(error).toBeNull()
    const result = data as unknown as { tenant_id: string; role_granted: boolean }
    expect(result.role_granted).toBe(true)

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('tenant_id', tenant.id)
      .single()
    expect(roleRow!.role).toBe('official')
  })

  // Shape-contract guard, same reasoning as the phone-fallback file: a
  // future `replace` migration on this function could silently drop or
  // rename a key route.ts / tenant.ts destructure without any type error,
  // since supabase gen types cannot see inside a jsonb return.
  it('returns exactly tenant_id and role_granted, no more and no fewer keys', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-07 Token Shape Contract')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    const { token } = await createTokenInvite(tenant.id, phone)

    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
    })
    if (userError) throw userError
    createdUserIds.push(userData.user.id)

    const { data, error } = await confirmByToken(
      admin,
      token,
      userData.user.id,
      phone,
      'Confirmed Name',
      true
    )
    expect(error).toBeNull()
    expect(Object.keys(data as object).sort()).toEqual(['role_granted', 'tenant_id'])
  })
})

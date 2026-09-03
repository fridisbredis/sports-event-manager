import { describe, it, expect, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { serviceClient, createTenant, createUserWithRole, signInAsClient } from './helpers'

// SEC-09 gap, flagged by Eduardo in PR #117 review (2026-09-03): the
// phone-fallback invite path (confirm_official_invite_by_phone, migration
// 0018/0045) never had its consent enforcement, its concurrency guard, or
// its RLS/grant boundary exercised against a real database — the app-layer
// unit tests all mock the RPC. This file exercises the actual function.

async function createPendingOfficial(tenantId: string, phone: string) {
  const admin = serviceClient()
  const { data, error } = await admin
    .from('officials')
    .insert({
      tenant_id: tenantId,
      name: 'Pending Official',
      phone,
      invite_status: 'invited',
      invite_token: null, // phone-fallback path: no token in play
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function confirmByPhone(
  admin: ReturnType<typeof serviceClient>,
  userId: string,
  phone: string,
  privacyAccepted: boolean
) {
  return admin.rpc('confirm_official_invite_by_phone', {
    p_user_id: userId,
    p_user_phone: phone,
    p_privacy_accepted: privacyAccepted,
  })
}

describe('confirm_official_invite_by_phone RPC (SEC-09 consent + concurrency)', () => {
  const createdTenantIds: string[] = []
  const createdUserIds: string[] = []

  afterAll(async () => {
    const admin = serviceClient()
    if (createdTenantIds.length > 0) {
      await admin.from('tenants').delete().in('id', createdTenantIds)
    }
    await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)))
  })

  it('rejects with privacy_not_accepted and writes nothing when consent is false', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-09 Consent False')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    const official = await createPendingOfficial(tenant.id, phone)

    const fakeUserId = '00000000-0000-0000-0000-000000000099'
    const { error } = await confirmByPhone(admin, fakeUserId, phone, false)

    expect(error).not.toBeNull()
    expect(error!.message).toContain('privacy_not_accepted')

    const { data: row } = await admin
      .from('officials')
      .select('invite_status, user_id, privacy_accepted_at')
      .eq('id', official.id)
      .single()

    // Consent rejection must be a no-op — no partial confirm, no role grant,
    // no timestamp — not just a rejected top-level call with side effects
    // still applied underneath.
    expect(row!.invite_status).toBe('invited')
    expect(row!.user_id).toBeNull()
    expect(row!.privacy_accepted_at).toBeNull()
  })

  it('confirms and records privacy_accepted_at when consent is true', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-09 Consent True')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    const official = await createPendingOfficial(tenant.id, phone)

    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
    })
    if (userError) throw userError
    createdUserIds.push(userData.user.id)

    const { data, error } = await confirmByPhone(admin, userData.user.id, phone, true)
    expect(error).toBeNull()
    expect((data as unknown as { tenant_id: string }).tenant_id).toBe(tenant.id)

    const { data: row } = await admin
      .from('officials')
      .select('invite_status, user_id, privacy_accepted_at')
      .eq('id', official.id)
      .single()

    expect(row!.invite_status).toBe('confirmed')
    expect(row!.user_id).toBe(userData.user.id)
    expect(row!.privacy_accepted_at).not.toBeNull()

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    expect(roleRow?.role).toBe('official')
  })

  // Adversarial: the app layer's row-lock protection claim (SELECT ... FOR
  // UPDATE + re-checked invite_status in the UPDATE WHERE clause) is only
  // real if two concurrent callers for the SAME invited phone cannot both
  // succeed. A mocked test of the calling code cannot prove this — only a
  // real transaction-level race against real Postgres can.
  it('under concurrent confirm attempts for the same phone, exactly one succeeds', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-09 Race')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    await createPendingOfficial(tenant.id, phone)

    const userIds = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        // Each concurrent caller needs its own distinct auth user — the RPC
        // takes p_user_id, not a real session — but these users are never
        // the ones with the invited phone; only p_user_phone (checked
        // against the officials row, not against the user's own phone) has
        // to match. Any unique placeholder phone satisfies auth.users'
        // NOT NULL-one-of(email, phone) constraint.
        const { data, error } = await admin.auth.admin.createUser({
          phone: `+4670${String(Date.now()).slice(-7)}${i}`,
          phone_confirm: true,
        })
        if (error) throw error
        createdUserIds.push(data.user.id)
        return data.user.id
      })
    )

    const results = await Promise.all(
      userIds.map((userId) => confirmByPhone(admin, userId, phone, true))
    )

    const succeeded = results.filter((r) => r.error === null)
    const failed = results.filter((r) => r.error !== null)

    // Exactly one caller wins the row lock and confirms; every other
    // concurrent caller must observe already_confirmed, not silently
    // succeed or silently corrupt the row.
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(4)
    // The loser of the row lock re-runs its own `WHERE ... invite_status =
    // 'invited'` SELECT after the winner has already flipped the row to
    // 'confirmed', so it finds no matching row at all (not_found) rather
    // than reaching the later already_confirmed check (which only fires for
    // the narrower window where the UPDATE's own row count comes back 0
    // after passing the initial SELECT). Both outcomes mean "you lost the
    // race, nothing was double-granted" — this asserts the actual one.
    for (const r of failed) {
      expect(r.error!.message).toContain('not_found')
    }
  })

  // Access-control boundary: this RPC is SECURITY DEFINER and revoked from
  // anon/authenticated (migration 0018/0045's REVOKE + GRANT to
  // service_role only). Confirmed directly here rather than only inferred
  // from reading the migration file, matching the pattern in
  // tests/integration/rate-limit.test.ts.
  describe('access control: anon/authenticated must be denied', () => {
    const anon: SupabaseClient<Database> = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    )
    let tenantId: string
    let authClient: SupabaseClient<Database>

    it('denies anon calling the RPC directly', async () => {
      const tenant = await createTenant('SEC-09 ACL Anon')
      createdTenantIds.push(tenant.id)
      const { error } = await confirmByPhone(
        anon,
        '00000000-0000-0000-0000-000000000098',
        '+46700000000',
        true
      )
      expect(error).not.toBeNull()
    })

    it('denies an authenticated non-admin user calling the RPC directly for an arbitrary phone', async () => {
      const tenant = await createTenant('SEC-09 ACL Authenticated')
      tenantId = tenant.id
      createdTenantIds.push(tenant.id)
      const { phone } = await createUserWithRole(tenantId, 'official')
      authClient = await signInAsClient(phone, '000000')

      // Attempts to confirm an unrelated phone number — even as a logged-in
      // user, this must be denied at the grant level (REVOKE ALL FROM
      // public), not merely fail on application logic later.
      const { error } = await confirmByPhone(
        authClient,
        '00000000-0000-0000-0000-000000000097',
        '+46709999999',
        true
      )
      expect(error).not.toBeNull()
    })
  })

  // Scope check, not a bug: participants have no invite/confirm flow at all
  // yet (see migration 0028's comment), so there is nothing analogous to
  // confirm_official_invite_by_phone to protect for that table. This pins
  // that assumption so a future participant invite flow doesn't silently
  // inherit an unprotected RPC by copy-paste.
  it('has no equivalent RPC for participants (documents current scope, not a gap)', async () => {
    const admin = serviceClient()
    const { error } = await admin.rpc(
      // @ts-expect-error — intentionally probing for a function that must not exist
      'confirm_participant_invite_by_phone',
      {}
    )
    expect(error).not.toBeNull()
  })
})

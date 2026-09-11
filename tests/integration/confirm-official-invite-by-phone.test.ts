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
      // A real, non-expired deadline (mirrors route.ts:81's +7 days) — these
      // tests exercise consent/concurrency/role-grant logic, not expiry, so
      // the fixture must not itself be an expired invite now that the RPC
      // enforces invite_token_expires_at (20260910120830).
      invite_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function createPendingOfficialWithRealToken(tenantId: string, phone: string) {
  // Mirrors the real creation path (src/app/api/officials/route.ts): no
  // invite_token in the insert payload, so it gets a real, non-null value
  // from officials.invite_token's DEFAULT gen_random_uuid() (migration
  // 0010) — exactly like every official actually created through the app.
  // invite_token_expires_at is set explicitly, same as route.ts:177, since
  // that column has no database default of its own.
  const admin = serviceClient()
  const { data, error } = await admin
    .from('officials')
    .insert({
      tenant_id: tenantId,
      name: 'Invited Official (never clicked link)',
      phone,
      invite_status: 'invited',
      invite_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function createPendingOfficialWithExpiry(tenantId: string, phone: string, expiresAt: string) {
  const admin = serviceClient()
  const { data, error } = await admin
    .from('officials')
    .insert({
      tenant_id: tenantId,
      name: 'Invited Official (expiry test)',
      phone,
      invite_status: 'invited',
      invite_token_expires_at: expiresAt,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function confirmByPhone(
  admin: ReturnType<typeof serviceClient>,
  userId: string,
  tenantId: string,
  phone: string,
  privacyAccepted: boolean
) {
  return admin.rpc('confirm_official_invite_by_phone', {
    p_user_id: userId,
    p_tenant_id: tenantId,
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
    const { error } = await confirmByPhone(admin, fakeUserId, tenant.id, phone, false)

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

    const { data, error } = await confirmByPhone(admin, userData.user.id, tenant.id, phone, true)
    expect(error).toBeNull()
    const result = data as unknown as { tenant_id: string; role_granted: boolean }
    expect(result.tenant_id).toBe(tenant.id)
    // Regression test for migration 0046: 0045 rewrote this RPC to add
    // consent enforcement and dropped the `role_granted` key that 0043 had
    // added — silently breaking the SEC-07 audit write in tenant.ts/route.ts,
    // which both destructure `data.role_granted` to decide whether to log
    // role_granted_via_invite_confirmation. The mocked unit tests for those
    // callers kept passing throughout, because they assert against a
    // hand-written mock response rather than this real function body. Only
    // this integration test, run against real Postgres, would have caught
    // the regression — that's why it belongs here, not just in tenant.test.ts.
    expect(result.role_granted).toBe(true)

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

  // Tenant-scoping regression test for 20260910145957: the same phone has a
  // pending invite in two different tenants, so p_tenant_id must select
  // between them rather than the lookup matching on phone alone. Confirming
  // with a tenant_id that has no pending invite for this phone must raise
  // not_found, not silently confirm a different tenant's row.
  it('raises not_found for a tenant_id with no pending invite for this phone, even when another tenant has one', async () => {
    const admin = serviceClient()
    const tenantWithInvite = await createTenant('SEC-09 Tenant Scoped A')
    createdTenantIds.push(tenantWithInvite.id)
    const tenantWithoutInvite = await createTenant('SEC-09 Tenant Scoped B')
    createdTenantIds.push(tenantWithoutInvite.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    await createPendingOfficial(tenantWithInvite.id, phone)

    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
    })
    if (userError) throw userError
    createdUserIds.push(userData.user.id)

    const { error } = await confirmByPhone(
      admin,
      userData.user.id,
      tenantWithoutInvite.id,
      phone,
      true
    )
    expect(error).not.toBeNull()
    expect(error!.message).toContain('not_found')

    const { data: row } = await admin
      .from('officials')
      .select('invite_status, user_id')
      .eq('tenant_id', tenantWithInvite.id)
      .eq('phone', phone)
      .single()
    expect(row!.invite_status).toBe('invited')
    expect(row!.user_id).toBeNull()
  })

  // Regression test for the unreachable-lookup fix: before it, this RPC's
  // lookup required invite_status = 'invited' AND invite_token IS NULL — a
  // combination no code path ever produces, since officials.invite_token
  // defaults to a real UUID at creation (migration 0010) and nothing nulls
  // it before this RPC's own UPDATE runs. An official who never visited
  // their /invite/[token] link and only completed OTP login could never be
  // confirmed; this RPC always raised not_found for them. This test creates
  // an official the way the real invite-creation endpoint does — with a
  // live, non-null invite_token — and asserts the phone-fallback confirm
  // now succeeds instead of raising not_found.
  it('confirms an official who still has a live invite_token and never visited the invite link', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('Unreachable Lookup Fix')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    const official = await createPendingOfficialWithRealToken(tenant.id, phone)
    expect(official.invite_token).not.toBeNull()

    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
    })
    if (userError) throw userError
    createdUserIds.push(userData.user.id)

    const { data, error } = await confirmByPhone(admin, userData.user.id, tenant.id, phone, true)
    expect(error).toBeNull()
    const result = data as unknown as { tenant_id: string; role_granted: boolean }
    expect(result.tenant_id).toBe(tenant.id)
    expect(result.role_granted).toBe(true)

    const { data: row } = await admin
      .from('officials')
      .select('invite_status, user_id, invite_token')
      .eq('id', official.id)
      .single()
    expect(row!.invite_status).toBe('confirmed')
    expect(row!.user_id).toBe(userData.user.id)
    // Confirming nulls the token so the /invite/[token] link can't also be
    // used afterward — same guarantee the no-token path already had.
    expect(row!.invite_token).toBeNull()
  })

  // PR #175 review: making the lookup reachable also made a pre-existing gap
  // live — this RPC never checked invite_token_expires_at, unlike the
  // token-based confirm_official_invite (0047), which raises 'expired'. That
  // was harmless while the phone lookup always raised not_found first; once
  // reachable, it meant an official who never opened their invite link could
  // confirm via OTP+phone arbitrarily long after the token path would have
  // refused the same invite as expired. Fixed by adding the same expiry
  // check here. Mirrors the privacy_not_accepted no-op assertions above:
  // rejection must leave the row untouched, not partially confirm it.
  it('rejects with expired and writes nothing once invite_token_expires_at has passed', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-09 Expired Invite')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    const expiresAt = new Date(Date.now() - 1000).toISOString()
    const official = await createPendingOfficialWithExpiry(tenant.id, phone, expiresAt)

    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
    })
    if (userError) throw userError
    createdUserIds.push(userData.user.id)

    const { error } = await confirmByPhone(admin, userData.user.id, tenant.id, phone, true)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('expired')

    const { data: row } = await admin
      .from('officials')
      .select('invite_status, user_id, privacy_accepted_at')
      .eq('id', official.id)
      .single()
    expect(row!.invite_status).toBe('invited')
    expect(row!.user_id).toBeNull()
    expect(row!.privacy_accepted_at).toBeNull()
  })

  // Regression test for migration 0047. Before 0047, the user_roles
  // insert's conflict target was (user_id, tenant_id), not (user_id,
  // tenant_id, role): if the confirming user already had ANY role in this
  // tenant, ON CONFLICT DO NOTHING fired, role_granted came back false, the
  // user_roles row stayed at the old role forever, and SEC-07's audit trail
  // missed the transition. 0047 replaced the insert with a single atomic
  // upsert (`on conflict ... do update ... where role is distinct from
  // excluded.role`) so this case is now a real, reported grant.
  it('grants the official role and reports role_granted=true when the user already has a different role in the tenant', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-09 Existing Role Conflict')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    await createPendingOfficial(tenant.id, phone)

    // This user already has a 'participant' role in the same tenant before
    // ever being confirmed as an official.
    const { userId } = await createUserWithRole(tenant.id, 'participant')
    createdUserIds.push(userId)

    const { data, error } = await confirmByPhone(admin, userId, tenant.id, phone, true)
    expect(error).toBeNull()
    const result = data as unknown as { tenant_id: string; role_granted: boolean }

    const { data: officialRow } = await admin
      .from('officials')
      .select('invite_status, user_id')
      .eq('tenant_id', tenant.id)
      .eq('phone', phone)
      .single()
    expect(officialRow!.invite_status).toBe('confirmed')
    expect(officialRow!.user_id).toBe(userId)

    // The pre-existing user_roles row is now updated to 'official' instead
    // of being left at 'participant', and the grant is reported.
    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenant.id)
      .single()
    expect(roleRow!.role).toBe('official')
    expect(result.role_granted).toBe(true)
  })

  // Guards against 0047 regressing 0043's original fix: an idempotent
  // re-confirm (the user is already 'official' in this tenant) must still
  // report role_granted=false. The upsert's `where role is distinct from
  // excluded.role` predicate is what makes ON CONFLICT match no row in
  // this case — if that predicate were dropped or inverted, this would
  // start over-reporting a grant that didn't happen.
  it('reports role_granted=false when the user is already an official in the tenant (idempotent re-confirm)', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-09 Idempotent Reconfirm')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`

    const { userId } = await createUserWithRole(tenant.id, 'official')
    createdUserIds.push(userId)

    // The official row this user already confirmed is now re-invited under
    // a fresh pending row (a distinct officials row, same tenant/phone) —
    // this is the phone-fallback path's "re-confirm" scenario, since it
    // matches on invite_status = 'invited' rather than a specific row id.
    await createPendingOfficial(tenant.id, phone)

    const { data, error } = await confirmByPhone(admin, userId, tenant.id, phone, true)
    expect(error).toBeNull()
    const result = data as unknown as { tenant_id: string; role_granted: boolean }

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenant.id)
      .single()
    expect(roleRow!.role).toBe('official')
    expect(result.role_granted).toBe(false)
  })

  // Migration 0047's upsert only overwrites the existing role when it is
  // 'participant', deliberately narrower than "overwrite whenever the role
  // differs". The invite-creation path (src/app/api/officials/route.ts)
  // only checks for a duplicate `officials` row per tenant+phone — it
  // never checks user_roles — so an official invite can target a phone
  // that currently belongs to a tenant_admin in the same tenant.
  // Confirming it must not demote that role. (system_admin can't be the
  // conflict target here: its user_roles row always has tenant_id = null,
  // which the unique (user_id, tenant_id) constraint never matches
  // against the real tenant_id this upsert inserts.)
  it('does not demote an existing tenant_admin role and reports role_granted=false', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-09 No Demote tenant_admin')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    await createPendingOfficial(tenant.id, phone)

    const { userId } = await createUserWithRole(tenant.id, 'tenant_admin')
    createdUserIds.push(userId)

    const { data, error } = await confirmByPhone(admin, userId, tenant.id, phone, true)
    expect(error).toBeNull()
    const result = data as unknown as { tenant_id: string; role_granted: boolean }
    expect(result.role_granted).toBe(false)

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenant.id)
      .single()
    expect(roleRow!.role).toBe('tenant_admin')

    // confirmation and role-grant are decoupled: the officials row still
    // confirms and links user_id even though no role was granted
    const { data: officialRow } = await admin
      .from('officials')
      .select('invite_status, user_id')
      .eq('tenant_id', tenant.id)
      .eq('phone', phone)
      .single()
    expect(officialRow!.invite_status).toBe('confirmed')
    expect(officialRow!.user_id).toBe(userId)
  })

  // Adversarial, mirrors the same-phone race test above but for the
  // cross-role case this migration fixes: concurrent confirms where the
  // confirmer already holds a different role must still serialize to
  // exactly one grant and one consistent end state, not a TOCTOU window
  // where multiple callers read the same stale "old role" and each thinks
  // they are the one making the grant. The single-statement atomic upsert
  // (not a separate SELECT then INSERT/UPDATE) is what Postgres's own
  // row-level locking on the conflicting key serializes here.
  it('under concurrent confirm attempts by a user with an existing different role, the role ends up consistent', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-09 Cross-Role Race')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    await createPendingOfficial(tenant.id, phone)

    const { userId } = await createUserWithRole(tenant.id, 'participant')
    createdUserIds.push(userId)

    const results = await Promise.all(
      Array.from({ length: 5 }, () => confirmByPhone(admin, userId, tenant.id, phone, true))
    )

    const succeeded = results.filter((r) => r.error === null)
    const failed = results.filter((r) => r.error !== null)

    // Exactly one caller wins the officials row lock and confirms, same
    // guarantee as the same-phone race test above.
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(4)

    const winner = succeeded[0].data as unknown as { role_granted: boolean }
    expect(winner.role_granted).toBe(true)

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenant.id)
      .single()
    expect(roleRow!.role).toBe('official')
  })

  // Shape-contract guard (see AGENTS.md/CLAUDE.md's RPC return-shape
  // section): supabase gen types cannot see inside a jsonb return, so a
  // future `replace` migration on this function could silently drop or
  // rename a key that route.ts / tenant.ts destructure, exactly as 0045
  // once did to role_granted (fixed by 0046). Pinning the exact key set
  // here means the next such change fails a test instead of shipping dark.
  it('returns exactly tenant_id and role_granted, no more and no fewer keys', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('SEC-09 Shape Contract')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`
    await createPendingOfficial(tenant.id, phone)

    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
    })
    if (userError) throw userError
    createdUserIds.push(userData.user.id)

    const { data, error } = await confirmByPhone(admin, userData.user.id, tenant.id, phone, true)
    expect(error).toBeNull()
    expect(Object.keys(data as object).sort()).toEqual(['role_granted', 'tenant_id'])
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
      userIds.map((userId) => confirmByPhone(admin, userId, tenant.id, phone, true))
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
        tenant.id,
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
        tenantId,
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

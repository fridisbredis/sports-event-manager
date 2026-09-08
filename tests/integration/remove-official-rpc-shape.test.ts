import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// SEC-07-rest (migration 0048): remove_official's jsonb return shape is
// consumed via `data as unknown as { user_id: string | null }` in
// src/app/api/officials/[id]/route.ts. TypeScript can't see inside a jsonb
// return (db:types always emits Returns: Json), so only a real call against
// Postgres can catch a future replace-migration silently dropping this key
// — exactly what happened to confirm_official_invite_by_phone's
// role_granted key between migrations 0043 and 0045.
describe('remove_official RPC: response shape contract', () => {
  let tenant: { id: string }
  let clientAdmin: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenant = await createTenant('Tenant RemoveOfficialShape')
    const admin = await createUserWithRole(tenant.id, 'tenant_admin')
    clientAdmin = await signInAsClient(admin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
  })

  it("returns { ok: true, user_id } with the removed official's user_id when they had accepted their invite", async () => {
    const official = await createUserWithRole(tenant.id, 'official')
    const admin = serviceClient()
    const { data: officialRow } = await admin
      .from('officials')
      .select('id')
      .eq('user_id', official.userId)
      .eq('tenant_id', tenant.id)
      .single()
    if (!officialRow) throw new Error('fixture official not found')

    const { data, error } = await clientAdmin.rpc('remove_official', {
      p_official_id: officialRow.id,
      p_tenant_id: tenant.id,
    })

    expect(error).toBeNull()
    expect(data).toEqual({ ok: true, user_id: official.userId })
  })

  it('returns { ok: true, user_id: null } for an official who never accepted their invite', async () => {
    const admin = serviceClient()
    const { data: officialRow } = await admin
      .from('officials')
      .insert({
        tenant_id: tenant.id,
        name: 'Never Accepted',
        phone: '+46709100099',
        invite_status: 'invited',
      })
      .select('id')
      .single()
    if (!officialRow) throw new Error('fixture insert failed')

    const { data, error } = await clientAdmin.rpc('remove_official', {
      p_official_id: officialRow.id,
      p_tenant_id: tenant.id,
    })

    expect(error).toBeNull()
    expect(data).toEqual({ ok: true, user_id: null })
  })

  // SEC-07-rest end-to-end: this mirrors exactly what
  // src/app/api/officials/[id]/route.ts does after a successful RPC call —
  // destructure user_id from the jsonb response and insert it as
  // audit_events.target_id on the same session client. A unit test can only
  // assert that logAuditEvent was *called* with the right argument (mocked);
  // this proves the value actually round-trips into a real row under RLS,
  // not just that the call site passes the right shape to a mock.
  it('the destructured user_id can be written as a real audit_events.target_id row', async () => {
    const official = await createUserWithRole(tenant.id, 'official')
    const admin = serviceClient()
    const { data: officialRow } = await admin
      .from('officials')
      .select('id')
      .eq('user_id', official.userId)
      .eq('tenant_id', tenant.id)
      .single()
    if (!officialRow) throw new Error('fixture official not found')

    const { data: rpcData, error: rpcError } = await clientAdmin.rpc('remove_official', {
      p_official_id: officialRow.id,
      p_tenant_id: tenant.id,
    })
    expect(rpcError).toBeNull()

    const { user_id: revokedUserId } = rpcData as unknown as { user_id: string | null }

    const { data: authData } = await clientAdmin.auth.getUser()
    const actorUserId = authData.user!.id

    const { error: auditError } = await clientAdmin.from('audit_events').insert({
      tenant_id: tenant.id,
      actor_user_id: actorUserId,
      actor_role: 'tenant_admin',
      action: 'role_revoked',
      target_type: 'user_role',
      target_id: revokedUserId,
      detail: { officialId: officialRow.id },
    })
    expect(auditError).toBeNull()

    // audit_events is intentionally read/write only via the session client
    // (RLS is the real gate — see ADR-0001); service_role has no SELECT
    // grant on this table, so the read-back must go through clientAdmin too.
    const { data: auditRow } = await clientAdmin
      .from('audit_events')
      .select('target_id, action')
      .eq('tenant_id', tenant.id)
      .eq('action', 'role_revoked')
      .eq('target_id', official.userId)
      .maybeSingle()

    expect(auditRow?.target_id).toBe(official.userId)
  })
})

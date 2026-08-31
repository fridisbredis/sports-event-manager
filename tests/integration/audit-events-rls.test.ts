import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  createSystemAdmin,
  signInAsClient,
  cleanupTenant,
  deleteAuthUser,
} from './helpers'

// SEC-07: audit_events RLS is the real access-control gate (the app-level
// logAuditEvent() helper always uses the session client, never service-role
// — see docs/adr/0001-service-role-vs-session-client.md). This exercises
// that gate directly against real Postgres, since RLS behavior — a real
// 42501 denial, cross-tenant row visibility — cannot be verified through a
// mock.

describe('audit_events RLS (SEC-07)', () => {
  let tenantAId: string
  let tenantBId: string
  let adminAClient: SupabaseClient<Database>
  let adminAUserId: string
  let adminBClient: SupabaseClient<Database>
  let systemAdminClient: SupabaseClient<Database>
  let systemAdminUserId: string

  beforeAll(async () => {
    const tenantA = await createTenant('Audit RLS Tenant A')
    const tenantB = await createTenant('Audit RLS Tenant B')
    tenantAId = tenantA.id
    tenantBId = tenantB.id

    const adminA = await createUserWithRole(tenantAId, 'tenant_admin')
    adminAUserId = adminA.userId
    adminAClient = await signInAsClient(adminA.phone, '000000')

    const adminB = await createUserWithRole(tenantBId, 'tenant_admin')
    adminBClient = await signInAsClient(adminB.phone, '000000')

    const sysAdmin = await createSystemAdmin()
    systemAdminUserId = sysAdmin.userId
    systemAdminClient = await signInAsClient(sysAdmin.phone, '000000')
  })

  afterAll(async () => {
    const admin = serviceClient()
    await admin.from('audit_events').delete().in('tenant_id', [tenantAId, tenantBId])
    await cleanupTenant(tenantAId)
    await cleanupTenant(tenantBId)
    await deleteAuthUser(systemAdminUserId)
  })

  it('lets a tenant_admin insert an audit row for their own tenant, self-attributed', async () => {
    const { error } = await adminAClient.from('audit_events').insert({
      tenant_id: tenantAId,
      actor_user_id: adminAUserId,
      actor_role: 'tenant_admin',
      action: 'tenant_tier_changed',
      target_type: 'tenant',
      target_id: tenantAId,
      detail: { tier: 'premium' },
    })

    expect(error).toBeNull()
  })

  it('denies a tenant_admin inserting a row for a different tenant', async () => {
    const { error } = await adminAClient.from('audit_events').insert({
      tenant_id: tenantBId,
      actor_user_id: adminAUserId,
      actor_role: 'tenant_admin',
      action: 'tenant_tier_changed',
      target_type: 'tenant',
      target_id: tenantBId,
      detail: {},
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('denies a tenant_admin inserting a row attributed to a different user', async () => {
    const { error } = await adminAClient.from('audit_events').insert({
      tenant_id: tenantAId,
      actor_user_id: systemAdminUserId,
      actor_role: 'tenant_admin',
      action: 'tenant_tier_changed',
      target_type: 'tenant',
      target_id: tenantAId,
      detail: {},
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('lets a tenant_admin read only their own tenant rows', async () => {
    const { data, error } = await adminAClient
      .from('audit_events')
      .select('tenant_id')
      .in('tenant_id', [tenantAId, tenantBId])

    expect(error).toBeNull()
    expect(data!.every((row) => row.tenant_id === tenantAId)).toBe(true)
    expect(data!.length).toBeGreaterThan(0)
  })

  it('lets a system_admin read rows across every tenant', async () => {
    const { data, error } = await systemAdminClient
      .from('audit_events')
      .select('tenant_id')
      .in('tenant_id', [tenantAId, tenantBId])

    expect(error).toBeNull()
    const seenTenantIds = new Set(data!.map((row) => row.tenant_id))
    expect(seenTenantIds.has(tenantAId)).toBe(true)
  })

  it('denies update on an audit row, even by its own actor', async () => {
    const { error } = await adminAClient
      .from('audit_events')
      .update({ detail: { tampered: true } })
      .eq('tenant_id', tenantAId)

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('denies delete on an audit row, even by system_admin', async () => {
    const { error } = await systemAdminClient
      .from('audit_events')
      .delete()
      .eq('tenant_id', tenantAId)

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it("denies a different tenant's admin from seeing tenant A's rows at all", async () => {
    const { data, error } = await adminBClient
      .from('audit_events')
      .select('tenant_id')
      .eq('tenant_id', tenantAId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

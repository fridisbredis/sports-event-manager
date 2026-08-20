import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// F-SEC-03: rows #2, #15, #17-19 of docs/security/service-role-audit.md are
// admin writes still on createSupabaseServiceClient(), gated by an explicit
// requireTenantAdmin()/assertSystemAdmin() check before the call. Before
// migrating any of them to the RLS-enforced session client, these tests
// prove the tenant_admin_manage_*/system_admin_all_tenants policies (FOR
// ALL) actually permit the exact write shapes those routes perform — not
// just reads, which the existing tenant-isolation-*.test.ts files cover.
// Each test signs in as the real role via test OTP, so this is RLS as the
// database evaluates it, not a mock.

describe('SEC-03: write migration readiness', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>
  let clientSystemAdmin: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A SEC03')
    tenantB = await createTenant('Tenant B SEC03')

    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')

    const sysAdmin = await createUserWithRole(tenantA.id, 'system_admin')
    clientSystemAdmin = await signInAsClient(sysAdmin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  // --- #2: (system)/admin/actions.ts — createTenant / setTenantActive / setTenantTier ---

  describe('row #2: system_admin cross-tenant writes', () => {
    it('system_admin can insert a new tenant', async () => {
      const { data, error } = await clientSystemAdmin
        .from('tenants')
        .insert({
          name: 'New Tenant via RLS',
          slug: `new-tenant-rls-${Date.now()}`,
          is_active: true,
        })
        .select()
        .single()

      expect(error).toBeNull()
      expect(data?.name).toBe('New Tenant via RLS')

      if (data) {
        const admin = serviceClient()
        await admin.from('tenants').delete().eq('id', data.id)
      }
    })

    it('system_admin can insert events and event_stages for a tenant it does not have an explicit user_roles row for', async () => {
      // Mirrors createTenant(): tenant insert, then events, then event_stages,
      // all as the same session client, for a brand-new tenant id.
      const { data: tenant, error: tenantError } = await clientSystemAdmin
        .from('tenants')
        .insert({ name: 'Fresh Tenant', slug: `fresh-tenant-${Date.now()}`, is_active: true })
        .select()
        .single()
      expect(tenantError).toBeNull()
      if (!tenant) throw new Error('tenant insert failed')

      const { data: event, error: eventError } = await clientSystemAdmin
        .from('events')
        .insert({
          tenant_id: tenant.id,
          name: 'Fresh Event',
          event_type: 'Event',
          status: 'draft',
          scheduling_granularity_min: 60,
        })
        .select()
        .single()
      expect(eventError).toBeNull()
      if (!event) throw new Error('event insert failed')

      const { error: stagesError } = await clientSystemAdmin.from('event_stages').insert([
        {
          event_id: event.id,
          tenant_id: tenant.id,
          name: 'Setup',
          stage_type: 'non_race',
          race_type: 'distance',
          position: 0,
        },
      ])
      expect(stagesError).toBeNull()

      const admin = serviceClient()
      await admin.from('tenants').delete().eq('id', tenant.id)
    })

    it('system_admin can update is_active and tier on any tenant', async () => {
      const { error: activeError } = await clientSystemAdmin
        .from('tenants')
        .update({ is_active: false })
        .eq('id', tenantB.id)
      expect(activeError).toBeNull()

      const { error: tierError } = await clientSystemAdmin
        .from('tenants')
        .update({ tier: 'premium' })
        .eq('id', tenantB.id)
      expect(tierError).toBeNull()

      const admin = serviceClient()
      const { data } = await admin
        .from('tenants')
        .select('is_active, tier')
        .eq('id', tenantB.id)
        .single()
      expect(data?.is_active).toBe(false)
      expect(data?.tier).toBe('premium')

      await admin.from('tenants').update({ is_active: true, tier: 'standard' }).eq('id', tenantB.id)
    })

    it('tenant_admin (not system_admin) cannot insert a new tenant', async () => {
      const { error } = await clientAdminA
        .from('tenants')
        .insert({ name: 'Forged Tenant', slug: `forged-${Date.now()}`, is_active: true })
      expect(error).not.toBeNull()
    })
  })

  // --- #15/#17/#18: officials insert / soft-delete / user_roles delete ---

  describe('rows #15, #17, #18: officials lifecycle writes', () => {
    it('tenant_admin can insert an official under its own tenant (mirrors POST /api/officials)', async () => {
      const { data, error } = await clientAdminA
        .from('officials')
        .insert({
          tenant_id: tenantA.id,
          name: 'Invited Official',
          phone: '+46709100001',
          invite_status: 'invited',
          invite_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single()

      expect(error).toBeNull()
      expect(data?.invite_status).toBe('invited')
    })

    it('tenant_admin can perform the #17 soft-delete sequence: delete assignments, update officials, delete user_roles', async () => {
      const admin = serviceClient()
      const created = await createUserWithRole(tenantA.id, 'official')
      const { data: official } = await admin
        .from('officials')
        .select('id, user_id')
        .eq('user_id', created.userId)
        .eq('tenant_id', tenantA.id)
        .single()
      if (!official) throw new Error('fixture official not found')

      const { data: event } = await admin
        .from('events')
        .insert({
          tenant_id: tenantA.id,
          name: 'Fixture Event',
          event_type: 'Event',
          start_date: '2026-01-01',
          end_date: '2026-01-02',
        })
        .select()
        .single()
      if (!event) throw new Error('event fixture failed')

      const { data: ws } = await admin
        .from('workstations')
        .insert({
          tenant_id: tenantA.id,
          event_id: event.id,
          name: 'WS for delete test',
          capacity_ceiling: 1,
        })
        .select()
        .single()
      if (!ws) throw new Error('workstation fixture failed')

      await admin.from('assignments').insert({
        tenant_id: tenantA.id,
        official_id: official.id,
        workstation_id: ws.id,
        timeslot_start: new Date().toISOString(),
        timeslot_end: new Date(Date.now() + 3600_000).toISOString(),
        status: 'assigned',
        slot_index: 0,
      })

      // Step 1: delete assignments
      const { error: assignmentsError } = await clientAdminA
        .from('assignments')
        .delete()
        .eq('official_id', official.id)
        .eq('tenant_id', tenantA.id)
      expect(assignmentsError).toBeNull()

      // Step 2: soft-delete officials row
      const { error: officialsError } = await clientAdminA
        .from('officials')
        .update({
          invite_status: 'removed',
          user_id: null,
          invite_token: null,
          invite_token_expires_at: null,
        })
        .eq('id', official.id)
        .eq('tenant_id', tenantA.id)
      expect(officialsError).toBeNull()

      // Step 3: revoke the 'official' user_roles row. Enabled by migration
      // 0024 (tenant_admin_revoke_official_role) — before that migration,
      // user_roles had no tenant_admin-scoped policy at all, and this delete
      // silently matched zero rows. See "Blocked: row #17" in
      // docs/security/service-role-audit.md for the before-state.
      const { error: roleError, count: roleDeleteCount } = await clientAdminA
        .from('user_roles')
        .delete({ count: 'exact' })
        .eq('user_id', official.user_id!)
        .eq('tenant_id', tenantA.id)
        .eq('role', 'official')
      expect(roleError).toBeNull()
      expect(roleDeleteCount).toBe(1)

      const { data: remainingRole } = await admin
        .from('user_roles')
        .select('id')
        .eq('user_id', official.user_id!)
        .eq('tenant_id', tenantA.id)
        .eq('role', 'official')
        .maybeSingle()
      expect(remainingRole).toBeNull()

      await admin.from('workstations').delete().eq('id', ws.id)
    })

    it('tenant_admin can revoke an official user_roles row via migration 0024, scoped to its own tenant', async () => {
      const created = await createUserWithRole(tenantA.id, 'official')

      const { error, count } = await clientAdminA
        .from('user_roles')
        .delete({ count: 'exact' })
        .eq('user_id', created.userId)
        .eq('tenant_id', tenantA.id)
        .eq('role', 'official')

      expect(error).toBeNull()
      expect(count).toBe(1)

      const admin = serviceClient()
      const { data: stillThere } = await admin
        .from('user_roles')
        .select('id')
        .eq('user_id', created.userId)
        .eq('tenant_id', tenantA.id)
        .eq('role', 'official')
        .maybeSingle()
      expect(stillThere).toBeNull()
    })

    it('tenant_admin cannot revoke an official user_roles row in a different tenant', async () => {
      const created = await createUserWithRole(tenantB.id, 'official')

      const { count } = await clientAdminA
        .from('user_roles')
        .delete({ count: 'exact' })
        .eq('user_id', created.userId)
        .eq('tenant_id', tenantB.id)
        .eq('role', 'official')

      expect(count).toBe(0)

      const admin = serviceClient()
      const { data: stillThere } = await admin
        .from('user_roles')
        .select('id')
        .eq('user_id', created.userId)
        .eq('tenant_id', tenantB.id)
        .eq('role', 'official')
        .maybeSingle()
      expect(stillThere).not.toBeNull()
    })

    it('tenant_admin cannot delete a tenant_admin or system_admin user_roles row — migration 0024 is scoped to role=official only', async () => {
      // Privilege-escalation guard: policy 0024's `role = 'official'` clause
      // must hold even when a tenant_admin targets a co-admin's row in the
      // SAME tenant they administer, or a system_admin's row anywhere.
      const coAdmin = await createUserWithRole(tenantA.id, 'tenant_admin')
      const sysAdmin = await createUserWithRole(tenantB.id, 'system_admin')

      const { count: coAdminDeleteCount } = await clientAdminA
        .from('user_roles')
        .delete({ count: 'exact' })
        .eq('user_id', coAdmin.userId)
        .eq('tenant_id', tenantA.id)
        .eq('role', 'tenant_admin')
      expect(coAdminDeleteCount).toBe(0)

      const { count: sysAdminDeleteCount } = await clientAdminA
        .from('user_roles')
        .delete({ count: 'exact' })
        .eq('user_id', sysAdmin.userId)
        .eq('tenant_id', tenantB.id)
        .eq('role', 'system_admin')
      expect(sysAdminDeleteCount).toBe(0)

      const admin = serviceClient()
      const { data: coAdminStillThere } = await admin
        .from('user_roles')
        .select('id')
        .eq('user_id', coAdmin.userId)
        .eq('role', 'tenant_admin')
        .maybeSingle()
      expect(coAdminStillThere).not.toBeNull()

      const { data: sysAdminStillThere } = await admin
        .from('user_roles')
        .select('id')
        .eq('user_id', sysAdmin.userId)
        .eq('role', 'system_admin')
        .maybeSingle()
      expect(sysAdminStillThere).not.toBeNull()
    })

    it('tenant_admin can rotate invite_token and invite_token_expires_at (mirrors POST resend)', async () => {
      const { data: official } = await clientAdminA
        .from('officials')
        .insert({
          tenant_id: tenantA.id,
          name: 'Resend Target',
          phone: '+46709100002',
          invite_status: 'invited',
          invite_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single()
      if (!official) throw new Error('fixture insert failed')

      const { error } = await clientAdminA
        .from('officials')
        .update({
          invite_token: '11111111-1111-1111-1111-111111111111',
          invite_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', official.id)
        .eq('tenant_id', tenantA.id)

      expect(error).toBeNull()
    })

    it('tenant_admin cannot write officials rows under a different tenant (isolation still holds under the FOR ALL policy)', async () => {
      const { error } = await clientAdminA
        .from('officials')
        .insert({ tenant_id: tenantB.id, name: 'Forged', phone: '+46709100003' })
      expect(error).not.toBeNull()

      const { data, error: deleteError } = await clientAdminA
        .from('officials')
        .delete()
        .eq('tenant_id', tenantB.id)
        .select()
      expect(deleteError).toBeNull()
      expect(data).toEqual([])
    })
  })

  // --- #19: announcements insert ---

  describe('row #19: announcements publish write', () => {
    it('tenant_admin can insert an announcement under its own tenant', async () => {
      const { data, error } = await clientAdminA
        .from('announcements')
        .insert({
          tenant_id: tenantA.id,
          channel: 'officials',
          body: 'Test announcement via RLS',
          sms_sent: false,
          published_at: new Date().toISOString(),
        })
        .select()
        .single()

      expect(error).toBeNull()
      expect(data?.body).toBe('Test announcement via RLS')
    })

    it('tenant_admin cannot insert an announcement under a different tenant', async () => {
      const { error } = await clientAdminA.from('announcements').insert({
        tenant_id: tenantB.id,
        channel: 'officials',
        body: 'Forged',
        sms_sent: false,
        published_at: new Date().toISOString(),
      })
      expect(error).not.toBeNull()
    })
  })
})

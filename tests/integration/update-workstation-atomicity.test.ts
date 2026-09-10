import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  cleanupTenant,
  serviceClient,
} from './helpers'

// REL-01: updateWorkstation() in
// src/app/(tenant)/[tenantSlug]/admin/workstations/actions.ts performs five
// separate operations with no surrounding transaction: update workstations,
// delete operating windows, insert new windows, delete todos, insert new
// todos. A failure on any later step (e.g. an invalid window) leaves the
// earlier steps committed — the windows/todos delete already happened even
// though the replacement insert never landed, silently wiping a
// workstation's schedule.
//
// This test reproduces that exact sequence directly against Postgres (not
// through the server action, which requires Next.js request context) to
// prove the gap, then exercises the new update_workstation RPC to prove the
// fix rolls back all writes together.
describe('updateWorkstation: atomicity across workstations/windows/todos', () => {
  let tenant: { id: string }
  let eventId: string
  let clientAdmin: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenant = await createTenant('Tenant Update WS Atomicity')
    const admin = serviceClient()
    const { data: event, error } = await admin
      .from('events')
      .insert({
        tenant_id: tenant.id,
        name: 'Atomicity Event',
        event_type: 'race',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
      })
      .select('id')
      .single()
    if (error) throw error
    eventId = event.id

    const tenantAdmin = await createUserWithRole(tenant.id, 'tenant_admin')
    clientAdmin = await signInAsClient(tenantAdmin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
  })

  async function seedWorkstationWithWindow() {
    const admin = serviceClient()
    const { data: workstation, error: wsError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenant.id,
        event_id: eventId,
        name: 'Original Name',
        capacity_ceiling: 3,
      })
      .select('id')
      .single()
    if (wsError) throw wsError

    const { error: winError } = await admin.from('workstation_operating_windows').insert({
      workstation_id: workstation.id,
      window_start: '2026-06-01T08:00:00Z',
      window_end: '2026-06-01T12:00:00Z',
    })
    if (winError) throw winError

    return workstation.id
  }

  it("documents the bug: today's uncoordinated delete+insert wipes the existing window when the replacement is invalid", async () => {
    const admin = serviceClient()
    const workstationId = await seedWorkstationWithWindow()

    // Reproduce updateWorkstation's exact sequence: update the row, then
    // delete+insert windows.
    const { error: updateError } = await admin
      .from('workstations')
      .update({ name: 'Updated Name', capacity_ceiling: 5 })
      .eq('id', workstationId)
      .eq('tenant_id', tenant.id)
    expect(updateError).toBeNull()

    const { error: delWinError } = await admin
      .from('workstation_operating_windows')
      .delete()
      .eq('workstation_id', workstationId)
    expect(delWinError).toBeNull()

    // Force the replacement insert to fail — window_end <= window_start
    // violates workstation_operating_windows' CHECK (window_end > window_start).
    const { error: insWinError } = await admin.from('workstation_operating_windows').insert({
      workstation_id: workstationId,
      window_start: '2026-06-01T12:00:00Z',
      window_end: '2026-06-01T08:00:00Z',
    })
    expect(insWinError).not.toBeNull()

    // The bug: the update committed and the old window is gone, even though
    // the replacement never landed — the workstation now has zero windows.
    const { data: survivingWorkstation } = await admin
      .from('workstations')
      .select('name')
      .eq('id', workstationId)
      .single()
    expect(survivingWorkstation?.name).toBe('Updated Name')

    const { data: survivingWindows } = await admin
      .from('workstation_operating_windows')
      .select('id')
      .eq('workstation_id', workstationId)
    expect(survivingWindows).toEqual([])
  })

  it('the fix: update_workstation RPC rolls back everything when the replacement window is invalid', async () => {
    const admin = serviceClient()
    const workstationId = await seedWorkstationWithWindow()

    const { error } = await clientAdmin.rpc('update_workstation', {
      p_workstation_id: workstationId,
      p_tenant_id: tenant.id,
      p_stage_id: undefined,
      p_name: 'Should Not Persist',
      p_description: undefined,
      p_capacity_ceiling: 5,
      p_recurring: false,
      p_windows: [{ window_start: '2026-06-01T12:00:00Z', window_end: '2026-06-01T08:00:00Z' }],
      p_todos: [],
    })

    expect(error).not.toBeNull()

    // Nothing should have changed: neither the workstation row nor its
    // original window.
    const { data: unchangedWorkstation } = await admin
      .from('workstations')
      .select('name, capacity_ceiling')
      .eq('id', workstationId)
      .single()
    expect(unchangedWorkstation).toEqual({ name: 'Original Name', capacity_ceiling: 3 })

    const { data: unchangedWindows } = await admin
      .from('workstation_operating_windows')
      .select('window_start, window_end')
      .eq('workstation_id', workstationId)
    expect(unchangedWindows).toEqual([
      { window_start: '2026-06-01T08:00:00+00:00', window_end: '2026-06-01T12:00:00+00:00' },
    ])
  })

  it('the fix: update_workstation RPC applies workstation/windows/todos together on success', async () => {
    const admin = serviceClient()
    const workstationId = await seedWorkstationWithWindow()

    const { data, error } = await clientAdmin.rpc('update_workstation', {
      p_workstation_id: workstationId,
      p_tenant_id: tenant.id,
      p_stage_id: undefined,
      p_name: 'Updated Name',
      p_description: 'Updated description',
      p_capacity_ceiling: 7,
      p_recurring: true,
      p_windows: [{ window_start: '2026-06-01T09:00:00Z', window_end: '2026-06-01T17:00:00Z' }],
      p_todos: ['Check badge', 'Set up cones'],
    })

    expect(error).toBeNull()
    expect(data).toEqual({ ok: true })

    const { data: workstation } = await admin
      .from('workstations')
      .select('name, description, capacity_ceiling, recurring')
      .eq('id', workstationId)
      .single()
    expect(workstation).toEqual({
      name: 'Updated Name',
      description: 'Updated description',
      capacity_ceiling: 7,
      recurring: true,
    })

    const { data: windows } = await admin
      .from('workstation_operating_windows')
      .select('window_start, window_end')
      .eq('workstation_id', workstationId)
    expect(windows).toEqual([
      { window_start: '2026-06-01T09:00:00+00:00', window_end: '2026-06-01T17:00:00+00:00' },
    ])

    const { data: todos } = await admin
      .from('workstation_todos')
      .select('instruction_text, position')
      .eq('workstation_id', workstationId)
      .order('position')
    expect(todos).toEqual([
      { instruction_text: 'Check badge', position: 0 },
      { instruction_text: 'Set up cones', position: 1 },
    ])
  })
})

// Review follow-up (PR #156, Eduardo): update_workstation is SECURITY
// INVOKER — its entire security model *is* the caller's RLS plus the
// revoke-from-public/grant-to-authenticated pair the migration adds. The
// block above now calls the RPC as a real authenticated tenant_admin
// (serviceClient() is only used there to seed/verify table state, not to
// call the RPC). This block goes further, isolating RLS and cross-tenant
// guard behavior specifically, mirroring
// create-workstation-tenant-consistency.test.ts (migration 0059's analogous
// coverage for create_workstation).
describe('update_workstation: RLS and tenant-consistency as an authenticated caller', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let eventA: { id: string }
  let stageB: { id: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A Update WS RLS')
    tenantB = await createTenant('Tenant B Update WS RLS')

    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')

    const admin = serviceClient()

    const { data: eventAData, error: eventAError } = await admin
      .from('events')
      .insert({
        tenant_id: tenantA.id,
        name: 'Tenant A Event',
        event_type: 'race',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
      })
      .select()
      .single()
    if (eventAError) throw eventAError
    eventA = eventAData

    const { data: eventBData, error: eventBError } = await admin
      .from('events')
      .insert({
        tenant_id: tenantB.id,
        name: 'Tenant B Event',
        event_type: 'race',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
      })
      .select()
      .single()
    if (eventBError) throw eventBError

    const { data: stageBData, error: stageBError } = await admin
      .from('event_stages')
      .insert({
        tenant_id: tenantB.id,
        event_id: eventBData.id,
        name: 'Tenant B Stage',
        stage_date: '2026-06-01',
        stage_type: 'race',
        start_time: '2026-06-01T06:00:00Z',
        end_time: '2026-06-01T18:00:00Z',
      })
      .select()
      .single()
    if (stageBError) throw stageBError
    stageB = stageBData
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  async function seedOwnWorkstation() {
    const admin = serviceClient()
    const { data: workstation, error } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA.id,
        name: 'Original Name',
        capacity_ceiling: 3,
      })
      .select('id')
      .single()
    if (error) throw error
    return workstation.id
  }

  it('allows an authenticated tenant_admin to update their own workstation through RLS', async () => {
    const workstationId = await seedOwnWorkstation()

    const { data, error } = await clientAdminA.rpc('update_workstation', {
      p_workstation_id: workstationId,
      p_tenant_id: tenantA.id,
      p_stage_id: undefined,
      p_name: 'Updated By Tenant Admin',
      p_description: 'via RLS-scoped client',
      p_capacity_ceiling: 6,
      p_recurring: false,
      p_windows: [{ window_start: '2026-06-01T09:00:00Z', window_end: '2026-06-01T17:00:00Z' }],
      p_todos: ['Check badge'],
    })

    expect(error).toBeNull()
    expect(data).toEqual({ ok: true })

    const admin = serviceClient()
    const { data: workstation } = await admin
      .from('workstations')
      .select('name, description, capacity_ceiling')
      .eq('id', workstationId)
      .single()
    expect(workstation).toEqual({
      name: 'Updated By Tenant Admin',
      description: 'via RLS-scoped client',
      capacity_ceiling: 6,
    })
  })

  it("rejects a tenant_admin trying to update another tenant's workstation", async () => {
    const admin = serviceClient()
    const { data: eventBForWorkstation, error: eventBError } = await admin
      .from('events')
      .insert({
        tenant_id: tenantB.id,
        name: 'Tenant B Event For Foreign Workstation',
        event_type: 'race',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
      })
      .select('id')
      .single()
    if (eventBError) throw eventBError

    const { data: foreignWorkstation, error: insertError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantB.id,
        event_id: eventBForWorkstation.id,
        name: 'Tenant B Workstation',
        capacity_ceiling: 3,
      })
      .select('id')
      .single()
    if (insertError) throw insertError

    const { data, error } = await clientAdminA.rpc('update_workstation', {
      p_workstation_id: foreignWorkstation.id,
      p_tenant_id: tenantA.id,
      p_stage_id: undefined,
      p_name: 'Hijacked',
      p_description: undefined,
      p_capacity_ceiling: 1,
      p_recurring: false,
      p_windows: [],
      p_todos: [],
    })

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.message).toContain('Invalid workstation payload')

    const { data: unchanged } = await admin
      .from('workstations')
      .select('name')
      .eq('id', foreignWorkstation.id)
      .single()
    expect(unchanged?.name).toBe('Tenant B Workstation')
  })

  // Review follow-up (PR #156, Eduardo, second pass): the test above sends
  // an honest p_tenant_id (tenant A's own) paired with a foreign
  // workstation_id. That combination is rejected by the guard's own column
  // comparison (w.tenant_id = p_tenant_id) alone — it would reject
  // identically even with the function switched to SECURITY DEFINER, so it
  // does not actually prove RLS is load-bearing.
  //
  // This test isolates RLS specifically: both p_workstation_id and
  // p_tenant_id honestly refer to tenant B, called from tenant A's client.
  // Both guard predicates match on columns alone, so the only thing that
  // can make `select 1 from workstations` return zero rows for this caller
  // is tenant_member_read_workstations hiding the row from admin A. Under
  // SECURITY DEFINER, this exact call would sail through and update another
  // tenant's workstation — see create-workstation-tenant-consistency.test.ts:210
  // for the analogous case on migration 0059.
  it('rejects an internally consistent foreign payload (own tenant_id/workstation_id pair, wrong tenant) via RLS alone', async () => {
    const admin = serviceClient()
    const { data: eventBForOwnPayload, error: eventBError } = await admin
      .from('events')
      .insert({
        tenant_id: tenantB.id,
        name: 'Tenant B Event For RLS-Isolated Payload',
        event_type: 'race',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
      })
      .select('id')
      .single()
    if (eventBError) throw eventBError

    const { data: tenantBWorkstation, error: insertError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantB.id,
        event_id: eventBForOwnPayload.id,
        name: 'Tenant B Own-Payload Workstation',
        capacity_ceiling: 3,
      })
      .select('id')
      .single()
    if (insertError) throw insertError

    const { data, error } = await clientAdminA.rpc('update_workstation', {
      p_workstation_id: tenantBWorkstation.id,
      p_tenant_id: tenantB.id,
      p_stage_id: undefined,
      p_name: 'Hijacked via internally consistent payload',
      p_description: undefined,
      p_capacity_ceiling: 1,
      p_recurring: false,
      p_windows: [],
      p_todos: [],
    })

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.message).toContain('Invalid workstation payload')

    const { data: unchanged } = await admin
      .from('workstations')
      .select('name')
      .eq('id', tenantBWorkstation.id)
      .single()
    expect(unchanged?.name).toBe('Tenant B Own-Payload Workstation')
  })

  it("rejects an honest workstation_id/tenant_id paired with another tenant's stage_id", async () => {
    const workstationId = await seedOwnWorkstation()

    const { data, error } = await clientAdminA.rpc('update_workstation', {
      p_workstation_id: workstationId,
      p_tenant_id: tenantA.id,
      p_stage_id: stageB.id,
      p_name: 'Cross-tenant stage update',
      p_description: undefined,
      p_capacity_ceiling: 3,
      p_recurring: false,
      p_windows: [],
      p_todos: [],
    })

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.message).toContain('Invalid workstation payload')
  })

  it('still allows an honest workstation_id/tenant_id/stage_id combination', async () => {
    const admin = serviceClient()
    const workstationId = await seedOwnWorkstation()
    const { data: stageAData, error: stageAError } = await admin
      .from('event_stages')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA.id,
        name: 'Tenant A Stage',
        stage_date: '2026-06-01',
        stage_type: 'race',
        start_time: '2026-06-01T06:00:00Z',
        end_time: '2026-06-01T18:00:00Z',
      })
      .select()
      .single()
    if (stageAError) throw stageAError

    const { data, error } = await clientAdminA.rpc('update_workstation', {
      p_workstation_id: workstationId,
      p_tenant_id: tenantA.id,
      p_stage_id: stageAData.id,
      p_name: 'Own-tenant stage update',
      p_description: undefined,
      p_capacity_ceiling: 3,
      p_recurring: false,
      p_windows: [],
      p_todos: [],
    })

    expect(error).toBeNull()
    expect(data).toEqual({ ok: true })
  })
})

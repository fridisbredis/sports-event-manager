import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  cleanupTenant,
  serviceClient,
} from './helpers'

// SEC-01 (migration 0059): create_workstation (migration 0031) checked that
// p_tenant_id matched the caller's own tenant (via RLS on the workstations
// INSERT) but never checked that p_event_id/p_stage_id actually belonged to
// that tenant. workstations.event_id/stage_id are plain foreign keys with no
// cross-tenant constraint, so an honest tenant_id paired with a foreign
// event_id/stage_id inserted cleanly — the same defect class
// save_assignments_batch (migration 0033) was already guarded against for
// workstation_id/official_id. This suite proves the RPC now rejects that
// payload shape instead of silently creating a cross-tenant-linked row.
describe('SEC-01: create_workstation rejects cross-tenant event_id/stage_id', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let eventA: { id: string }
  let eventB: { id: string }
  let stageB: { id: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A WS Consistency')
    tenantB = await createTenant('Tenant B WS Consistency')

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
    eventB = eventBData

    const { data: stageBData, error: stageBError } = await admin
      .from('event_stages')
      .insert({
        tenant_id: tenantB.id,
        event_id: eventB.id,
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

  it("rejects an honest tenant_id paired with another tenant's event_id", async () => {
    const { data, error } = await clientAdminA.rpc('create_workstation', {
      p_tenant_id: tenantA.id,
      p_event_id: eventB.id,
      p_name: 'Cross-tenant event workstation',
      p_capacity_ceiling: 3,
      p_windows: [],
      p_todos: [],
    })

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.message).toContain('Invalid workstation payload')
  })

  it("rejects an honest tenant_id/event_id paired with another tenant's stage_id", async () => {
    const { data, error } = await clientAdminA.rpc('create_workstation', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
      p_stage_id: stageB.id,
      p_name: 'Cross-tenant stage workstation',
      p_capacity_ceiling: 3,
      p_windows: [],
      p_todos: [],
    })

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.message).toContain('Invalid workstation payload')
  })

  it('still allows an honest tenant_id/event_id/stage_id combination', async () => {
    const admin = serviceClient()
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

    const { data, error } = await clientAdminA.rpc('create_workstation', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
      p_stage_id: stageAData.id,
      p_name: 'Own-tenant workstation',
      p_capacity_ceiling: 3,
      p_windows: [],
      p_todos: [],
    })

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  // Migration 0060: the RPC guard above only covers callers going through
  // create_workstation. tenant_admin_manage_workstations (0007) is FOR ALL
  // with USING on tenant_id alone and no WITH CHECK, so a direct INSERT that
  // bypasses the RPC was still exploitable before 0060 added composite FKs
  // pinning event_id/stage_id to the same tenant_id. These assert the FK
  // itself rejects the mismatch, independent of the RPC.
  it('rejects a direct INSERT with a foreign event_id (bypassing the RPC)', async () => {
    const admin = serviceClient()
    const { error } = await admin.from('workstations').insert({
      tenant_id: tenantA.id,
      event_id: eventB.id,
      name: 'Direct-insert cross-tenant event workstation',
      capacity_ceiling: 3,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/workstations_event_tenant_fkey/)
  })

  it('rejects a direct INSERT with a foreign stage_id (bypassing the RPC)', async () => {
    const admin = serviceClient()
    const { error } = await admin.from('workstations').insert({
      tenant_id: tenantA.id,
      event_id: eventA.id,
      stage_id: stageB.id,
      name: 'Direct-insert cross-tenant stage workstation',
      capacity_ceiling: 3,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/workstations_stage_tenant_fkey/)
  })

  it('rejects a direct UPDATE that moves stage_id to a foreign tenant (the updateWorkstation path)', async () => {
    const admin = serviceClient()
    const { data: ownWorkstation, error: insertError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA.id,
        name: 'Own-tenant workstation for update test',
        capacity_ceiling: 3,
      })
      .select()
      .single()
    if (insertError) throw insertError

    const { error } = await admin
      .from('workstations')
      .update({ stage_id: stageB.id })
      .eq('id', ownWorkstation.id)

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/workstations_stage_tenant_fkey/)
  })

  // The three tests above use serviceClient() to isolate the FK from RLS.
  // This one exercises the actual threat model the 0060 header names: "a
  // tenant_admin hitting PostgREST directly" — same request shape a browser
  // client would send, going through RLS (which allows it, since
  // tenant_admin_manage_workstations has no WITH CHECK) before the new
  // composite FK is what actually stops the write.
  it("rejects tenant_admin A's own direct INSERT with a foreign event_id via RLS-scoped client", async () => {
    const { error } = await clientAdminA.from('workstations').insert({
      tenant_id: tenantA.id,
      event_id: eventB.id,
      name: 'RLS-client direct-insert cross-tenant event workstation',
      capacity_ceiling: 3,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/workstations_event_tenant_fkey/)
  })
})

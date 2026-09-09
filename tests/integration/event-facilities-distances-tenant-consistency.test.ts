import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  cleanupTenant,
  serviceClient,
} from './helpers'

// SEC-01 (migration 20260909123808): event_facilities.event_id and
// event_distances.event_id/stage_id were plain foreign keys with no check
// that the referenced row belonged to the same tenant_id as the child row.
// tenant_admin_manage_event_facilities / tenant_admin_manage_event_distances
// (migration 0005) are FOR ALL policies with a USING predicate on tenant_id
// alone and no WITH CHECK, so a direct INSERT with an honest tenant_id
// paired with a foreign event_id/stage_id inserted cleanly. Neither
// sync_event_facilities nor sync_event_stages verifies p_event_id belongs to
// p_tenant_id either. This suite proves the composite FKs reject that
// payload shape, independent of RLS or any RPC-level check — same pattern
// as create-workstation-tenant-consistency.test.ts (migration 0060).
describe('SEC-01: event_facilities/event_distances reject cross-tenant event_id/stage_id', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let eventA: { id: string }
  let eventB: { id: string }
  let stageB: { id: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A Facilities Consistency')
    tenantB = await createTenant('Tenant B Facilities Consistency')

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

  it('rejects a direct INSERT into event_facilities with a foreign event_id', async () => {
    const admin = serviceClient()
    const { error } = await admin.from('event_facilities').insert({
      tenant_id: tenantA.id,
      event_id: eventB.id,
      label: 'Cross-tenant facility',
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/event_facilities_event_tenant_fkey/)
  })

  it('rejects a direct INSERT into event_distances with a foreign event_id', async () => {
    const admin = serviceClient()
    const { error } = await admin.from('event_distances').insert({
      tenant_id: tenantA.id,
      event_id: eventB.id,
      label: 'Cross-tenant distance',
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/event_distances_event_tenant_fkey/)
  })

  it('rejects a direct INSERT into event_distances with an honest event_id but a foreign stage_id', async () => {
    const admin = serviceClient()
    const { error } = await admin.from('event_distances').insert({
      tenant_id: tenantA.id,
      event_id: eventA.id,
      stage_id: stageB.id,
      label: 'Cross-tenant stage distance',
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/event_distances_stage_tenant_fkey/)
  })

  it('rejects a direct UPDATE that moves event_distances.stage_id to a foreign tenant', async () => {
    const admin = serviceClient()
    const { data: ownDistance, error: insertError } = await admin
      .from('event_distances')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA.id,
        label: 'Own-tenant distance for update test',
      })
      .select()
      .single()
    if (insertError) throw insertError

    const { error } = await admin
      .from('event_distances')
      .update({ stage_id: stageB.id })
      .eq('id', ownDistance.id)

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/event_distances_stage_tenant_fkey/)
  })

  it('rejects a direct UPDATE that moves event_facilities.event_id to a foreign tenant', async () => {
    const admin = serviceClient()
    const { data: ownFacility, error: insertError } = await admin
      .from('event_facilities')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA.id,
        label: 'Own-tenant facility for update test',
      })
      .select()
      .single()
    if (insertError) throw insertError

    const { error } = await admin
      .from('event_facilities')
      .update({ event_id: eventB.id })
      .eq('id', ownFacility.id)

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/event_facilities_event_tenant_fkey/)
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

    const { data, error } = await admin
      .from('event_distances')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA.id,
        stage_id: stageAData.id,
        label: 'Own-tenant distance',
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  // Exercises the actual threat model: a tenant_admin hitting PostgREST
  // directly (same request shape a browser client would send), going
  // through RLS (which allows it, since tenant_admin_manage_event_facilities
  // has no WITH CHECK) before the composite FK is what stops the write.
  it("rejects tenant_admin A's own direct INSERT into event_facilities with a foreign event_id via RLS-scoped client", async () => {
    const { error } = await clientAdminA.from('event_facilities').insert({
      tenant_id: tenantA.id,
      event_id: eventB.id,
      label: 'RLS-client direct-insert cross-tenant facility',
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/event_facilities_event_tenant_fkey/)
  })
})

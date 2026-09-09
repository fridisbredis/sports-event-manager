import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// F-REL-21 (migration 20260909133414): sync_event_stages (0058) only enforces
// "a published event keeps at least one Race stage" for callers going through
// that RPC. tenant_admin_manage_event_stages (0007) is FOR ALL with no WITH
// CHECK beyond tenant_id, so a tenant_admin can DELETE a Race stage straight
// through PostgREST, bypassing the RPC entirely. These tests exercise that
// exact bypass path directly (.from('event_stages').delete(), not .rpc(...))
// against a deferred constraint trigger, so a future migration that silently
// drops the trigger is caught the same way sync-event-stages-race-guard.test.ts
// catches a regression in the RPC-level guard.
describe('event_stages published-event Race-stage guard: direct DELETE (F-REL-21)', () => {
  let tenant: { id: string }
  let clientAdmin: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenant = await createTenant('Tenant EventStagesTriggerGuard')
    const admin = await createUserWithRole(tenant.id, 'tenant_admin')
    clientAdmin = await signInAsClient(admin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
  })

  async function createEvent(status: 'draft' | 'published') {
    const admin = serviceClient()
    const { data, error } = await admin
      .from('events')
      .insert({
        tenant_id: tenant.id,
        name: 'Trigger Guard Test Event',
        event_type: 'race',
        status,
      })
      .select()
      .single()
    if (error) throw error
    return data
  }

  async function addRaceStage(eventId: string) {
    const admin = serviceClient()
    const { data, error } = await admin
      .from('event_stages')
      .insert({
        event_id: eventId,
        tenant_id: tenant.id,
        name: 'Stage 1',
        stage_type: 'race',
        race_type: 'distance',
        position: 0,
      })
      .select()
      .single()
    if (error) throw error
    return data
  }

  it('rejects a direct DELETE of the only Race stage on a published event (23514)', async () => {
    const event = await createEvent('published')
    const stage = await addRaceStage(event.id)

    const { error } = await clientAdmin.from('event_stages').delete().eq('id', stage.id)

    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('Cannot remove the last Race stage from a published event.')

    // Deferred trigger fires at commit time, but the whole request still
    // rolls back — the row must still be there.
    const admin = serviceClient()
    const { data } = await admin.from('event_stages').select('id').eq('id', stage.id).maybeSingle()
    expect(data).not.toBeNull()
  })

  it('allows the direct DELETE when a published event still has another Race stage left', async () => {
    const event = await createEvent('published')
    const keptStage = await addRaceStage(event.id)
    const removedStage = await addRaceStage(event.id)

    const { error } = await clientAdmin.from('event_stages').delete().eq('id', removedStage.id)

    expect(error).toBeNull()
    const admin = serviceClient()
    const { data } = await admin.from('event_stages').select('id').eq('event_id', event.id)
    expect(data?.map((row) => row.id)).toEqual([keptStage.id])
  })

  it('allows a direct DELETE of the only Race stage on a draft event', async () => {
    const event = await createEvent('draft')
    const stage = await addRaceStage(event.id)

    const { error } = await clientAdmin.from('event_stages').delete().eq('id', stage.id)

    expect(error).toBeNull()
    const admin = serviceClient()
    const { data } = await admin.from('event_stages').select('id').eq('id', stage.id).maybeSingle()
    expect(data).toBeNull()
  })

  it('rejects UPDATE stage_type away from race on the only Race stage of a published event (23514)', async () => {
    const event = await createEvent('published')
    const stage = await addRaceStage(event.id)

    const { error } = await clientAdmin
      .from('event_stages')
      .update({ stage_type: 'non_race' })
      .eq('id', stage.id)

    expect(error?.code).toBe('23514')

    const admin = serviceClient()
    const { data } = await admin.from('event_stages').select('stage_type').eq('id', stage.id).single()
    expect(data?.stage_type).toBe('race')
  })

  // COALESCE(NEW.event_id, OLD.event_id) always resolves to NEW on UPDATE
  // (never null), so a naive version of this trigger only ever re-checks the
  // destination event and never the source event a row was moved off of.
  it('rejects UPDATE event_id that moves the only Race stage off a published source event (23514)', async () => {
    const sourceEvent = await createEvent('published')
    const destEvent = await createEvent('published')
    const movedStage = await addRaceStage(sourceEvent.id)
    await addRaceStage(destEvent.id) // keeps destEvent valid regardless of outcome

    const { error } = await clientAdmin
      .from('event_stages')
      .update({ event_id: destEvent.id })
      .eq('id', movedStage.id)

    expect(error?.code).toBe('23514')

    const admin = serviceClient()
    const { data } = await admin.from('event_stages').select('event_id').eq('id', movedStage.id).single()
    expect(data?.event_id).toBe(sourceEvent.id)
  })

  it('allows UPDATE event_id moving a Race stage away when the source event keeps another Race stage', async () => {
    const sourceEvent = await createEvent('published')
    const destEvent = await createEvent('published')
    const keptStage = await addRaceStage(sourceEvent.id)
    const movedStage = await addRaceStage(sourceEvent.id)
    await addRaceStage(destEvent.id)

    const { error } = await clientAdmin
      .from('event_stages')
      .update({ event_id: destEvent.id })
      .eq('id', movedStage.id)

    expect(error).toBeNull()

    const admin = serviceClient()
    const { data } = await admin.from('event_stages').select('id, event_id').eq('id', movedStage.id).single()
    expect(data?.event_id).toBe(destEvent.id)

    const { data: sourceStages } = await admin.from('event_stages').select('id').eq('event_id', sourceEvent.id)
    expect(sourceStages?.map((row) => row.id)).toEqual([keptStage.id])
  })
})

// F-REL-17 (migration 20260909133414): sync_event_stages takes p_event_id and
// p_tenant_id as independent parameters with nothing tying them together, and
// tenant_admin_manage_event_stages' RLS USING clause only checks tenant_id —
// it does not check that event_id actually belongs to that tenant. A
// tenant_admin of tenant A could previously write an event_stages row with
// tenant_id = A but event_id pointing at tenant B's event. The composite FK
// added by this migration (event_stages_event_tenant_fkey, referencing
// events(id, tenant_id)) closes this at the schema level, independent of RLS.
describe('event_stages composite tenant FK (F-REL-17)', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant EventStagesFkGuardA')
    tenantB = await createTenant('Tenant EventStagesFkGuardB')
    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  it('rejects an event_stages row whose event_id belongs to a different tenant than tenant_id (23503)', async () => {
    const admin = serviceClient()
    const { data: eventB, error: eventError } = await admin
      .from('events')
      .insert({ tenant_id: tenantB.id, name: 'Tenant B Event', event_type: 'race', status: 'draft' })
      .select()
      .single()
    if (eventError) throw eventError

    // RLS alone would allow this: tenant_id = tenantA.id passes
    // tenant_admin_manage_event_stages' USING clause, which never inspects
    // event_id. Only the composite FK stops it.
    const { error } = await clientAdminA.from('event_stages').insert({
      event_id: eventB.id,
      tenant_id: tenantA.id,
      name: 'Cross-tenant stage',
      stage_type: 'race',
      race_type: 'distance',
      position: 0,
    })

    expect(error?.code).toBe('23503')
  })
})

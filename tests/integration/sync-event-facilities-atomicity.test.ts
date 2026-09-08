import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTenant, cleanupTenant, serviceClient } from './helpers'

// REL-01: saveEvent() in src/app/(tenant)/[tenantSlug]/admin/event/actions.ts
// replaces event_facilities via two separate operations with no surrounding
// transaction: delete all existing facilities, then insert the new set. A
// failure on the insert (e.g. an invalid label) leaves the delete already
// committed — the event silently ends up with zero facilities instead of
// either its old set or its new one. Same defect class already fixed for
// event_stages via sync_event_stages (migration 0005).
//
// This test reproduces that exact sequence directly against Postgres (not
// through the server action, which requires Next.js request context) to
// prove the gap, then exercises the new sync_event_facilities RPC to prove
// the fix rolls back both statements together.
describe('saveEvent: atomicity of event_facilities replacement', () => {
  let tenant: { id: string }
  let eventId: string

  beforeAll(async () => {
    tenant = await createTenant('Tenant Facilities Atomicity')
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
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
  })

  async function seedFacility() {
    const admin = serviceClient()
    const { error } = await admin.from('event_facilities').insert({
      tenant_id: tenant.id,
      event_id: eventId,
      label: 'Original Facility',
      position: 0,
    })
    if (error) throw error
  }

  it("documents the bug: today's delete-then-insert leaves zero facilities when the replacement insert is invalid", async () => {
    const admin = serviceClient()
    await seedFacility()

    // Reproduce saveEvent's exact sequence: delete all, then insert the new
    // set.
    const { error: delError } = await admin
      .from('event_facilities')
      .delete()
      .eq('event_id', eventId)
      .eq('tenant_id', tenant.id)
    expect(delError).toBeNull()

    // Force the replacement insert to fail — label is NOT NULL.
    const { error: insError } = await admin.from('event_facilities').insert([
      {
        tenant_id: tenant.id,
        event_id: eventId,
        label: null as unknown as string,
        position: 0,
      },
    ])
    expect(insError).not.toBeNull()

    // The bug: the delete committed, so the event now has zero facilities —
    // neither the old set nor the (failed) new one.
    const { data: survivingFacilities } = await admin
      .from('event_facilities')
      .select('id')
      .eq('event_id', eventId)
    expect(survivingFacilities).toEqual([])
  })

  it('the fix: sync_event_facilities RPC rolls back everything when one row in the replacement set is malformed', async () => {
    const admin = serviceClient()
    await seedFacility()

    // A non-numeric position fails the ::integer cast mid-insert, after the
    // delete has already run inside the same function call — this is not
    // filtered by the RPC (unlike a blank label), so it proves a real
    // mid-transaction failure rolls back the delete too.
    const { error } = await admin.rpc('sync_event_facilities', {
      p_event_id: eventId,
      p_tenant_id: tenant.id,
      p_facilities: [
        { label: 'Showers', position: 0 },
        { label: 'Parking', position: 'not-a-number' },
      ],
    })

    expect(error).not.toBeNull()

    // The fix: the original facility must still be there — the delete
    // rolled back along with the failed insert, not left partially applied.
    const { data: facilities } = await admin
      .from('event_facilities')
      .select('label, position')
      .eq('event_id', eventId)
    expect(facilities).toEqual([{ label: 'Original Facility', position: 0 }])
  })

  it('the fix: sync_event_facilities RPC replaces the full set atomically on success', async () => {
    const admin = serviceClient()
    await seedFacility()

    const { error } = await admin.rpc('sync_event_facilities', {
      p_event_id: eventId,
      p_tenant_id: tenant.id,
      p_facilities: [
        { label: 'Showers', position: 0 },
        { label: 'Parking', position: 1 },
      ],
    })
    expect(error).toBeNull()

    const { data: facilities } = await admin
      .from('event_facilities')
      .select('label, position')
      .eq('event_id', eventId)
      .order('position')
    expect(facilities).toEqual([
      { label: 'Showers', position: 0 },
      { label: 'Parking', position: 1 },
    ])
  })
})

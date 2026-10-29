import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  cleanupTenant,
  createUserWithRole,
  signInAsClient,
} from './helpers'

// N23 (7c): Remove on OFF-01 takes an official out of one event, and out of
// the tenant only when it was their last. Called as a signed-in tenant admin,
// through RLS, as the route calls it.
describe('N23: remove_official_from_event', () => {
  let tenantId: string
  let eventA: string
  let eventB: string
  let officialId: string
  let adminClient: SupabaseClient<Database>

  beforeAll(async () => {
    const admin = serviceClient()
    tenantId = (await createTenant('Remove From Event', 'premium')).id

    const { data: events, error: eventError } = await admin
      .from('events')
      .insert([
        { tenant_id: tenantId, name: 'A', event_type: 'race' },
        { tenant_id: tenantId, name: 'B', event_type: 'race' },
      ])
      .select('id, name')
    if (eventError) throw eventError
    eventA = events.find((e) => e.name === 'A')!.id
    eventB = events.find((e) => e.name === 'B')!.id

    const { data: official, error: officialError } = await admin
      .from('officials')
      .insert({
        tenant_id: tenantId,
        name: 'Two Events',
        phone: '+46704400001',
        invite_status: 'confirmed',
      })
      .select('id')
      .single()
    if (officialError) throw officialError
    officialId = official.id

    const { error: memberError } = await admin.from('official_events').insert([
      { official_id: officialId, event_id: eventA, tenant_id: tenantId },
      { official_id: officialId, event_id: eventB, tenant_id: tenantId },
    ])
    if (memberError) throw memberError

    // One shift in each event.
    for (const eventId of [eventA, eventB]) {
      const { data: ws, error: wsError } = await admin
        .from('workstations')
        .insert({ tenant_id: tenantId, event_id: eventId, name: 'Desk', capacity_ceiling: 2 })
        .select('id')
        .single()
      if (wsError) throw wsError
      const { error: assignmentError } = await admin.from('assignments').insert({
        tenant_id: tenantId,
        event_id: eventId,
        official_id: officialId,
        workstation_id: ws.id,
        timeslot_start: '2027-06-01T08:00:00+00:00',
        timeslot_end: '2027-06-01T09:00:00+00:00',
        slot_index: 0,
      })
      if (assignmentError) throw assignmentError
    }

    const { phone } = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  async function state() {
    const admin = serviceClient()
    const [{ data: memberships }, { data: assignments }, { data: official }] = await Promise.all([
      admin.from('official_events').select('event_id').eq('official_id', officialId),
      admin.from('assignments').select('event_id').eq('official_id', officialId),
      admin.from('officials').select('invite_status').eq('id', officialId).single(),
    ])
    return {
      events: (memberships ?? []).map((m) => m.event_id).sort(),
      shifts: (assignments ?? []).map((a) => a.event_id).sort(),
      status: official?.invite_status,
    }
  }

  it('takes them out of one event and keeps the other', async () => {
    const { data, error } = await adminClient.rpc('remove_official_from_event', {
      p_official_id: officialId,
      p_event_id: eventA,
      p_tenant_id: tenantId,
    })
    expect(error).toBeNull()
    // The keys the route reads.
    expect(data).toEqual({ removed_from_tenant: false, user_id: null })
    expect(await state()).toEqual({ events: [eventB], shifts: [eventB], status: 'confirmed' })
  })

  it('reports not_found for an event they are not in', async () => {
    const { error } = await adminClient.rpc('remove_official_from_event', {
      p_official_id: officialId,
      p_event_id: eventA,
      p_tenant_id: tenantId,
    })
    expect(error?.message).toBe('not_found')
  })

  it('removes them from the tenant when it was their last event', async () => {
    const { data, error } = await adminClient.rpc('remove_official_from_event', {
      p_official_id: officialId,
      p_event_id: eventB,
      p_tenant_id: tenantId,
    })
    expect(error).toBeNull()
    expect(data).toEqual({ removed_from_tenant: true, user_id: null })
    expect(await state()).toEqual({ events: [], shifts: [], status: 'removed' })
  })
})

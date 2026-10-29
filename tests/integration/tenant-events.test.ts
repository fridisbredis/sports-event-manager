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
import { readTenantEvents } from '@/lib/events/tenant-events'

// N23 / TEN-01: the tenant dashboard's figures, read the way the page reads
// them — as a signed-in tenant admin, through RLS — and the archive and
// un-archive writes the page's action makes, against the real cap trigger.
describe('N23: tenant event list and archiving', () => {
  let tenantId: string
  let otherTenantId: string
  let event2026: string
  let event2027: string
  let adminClient: SupabaseClient<Database>

  async function insertEvent(tenant: string, name: string, status = 'draft') {
    const { data, error } = await serviceClient()
      .from('events')
      .insert({ tenant_id: tenant, name, event_type: 'race', status })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  async function addOfficial(phone: string, status: string, eventIds: string[]) {
    const admin = serviceClient()
    const { data, error } = await admin
      .from('officials')
      .insert({ tenant_id: tenantId, name: phone, phone, invite_status: status })
      .select('id')
      .single()
    if (error) throw error
    for (const eventId of eventIds) {
      const { error: memberError } = await admin
        .from('official_events')
        .insert({ official_id: data.id, event_id: eventId, tenant_id: tenantId })
      if (memberError) throw memberError
    }
  }

  beforeAll(async () => {
    // Premium: room for both events, and participants exist on this tier.
    tenantId = (await createTenant('Tenant Events', 'premium')).id
    otherTenantId = (await createTenant('Tenant Events Other')).id
    event2026 = await insertEvent(tenantId, 'Viadal 2026', 'published')
    event2027 = await insertEvent(tenantId, 'Viadal 2027')
    await insertEvent(otherTenantId, 'Not ours')

    const admin = serviceClient()
    const { error: stageError } = await admin.from('event_stages').insert([
      { tenant_id: tenantId, event_id: event2026, name: 'Day 1', stage_type: 'race' },
      { tenant_id: tenantId, event_id: event2026, name: 'Day 2', stage_type: 'race' },
    ])
    if (stageError) throw stageError
    const { error: participantError } = await admin
      .from('participants')
      .insert([{ tenant_id: tenantId, event_id: event2027, name: 'Runner A' }])
    if (participantError) throw participantError

    await addOfficial('+46704200001', 'confirmed', [event2026])
    await addOfficial('+46704200002', 'confirmed', [event2026, event2027])
    await addOfficial('+46704200003', 'invited', [event2027])

    const { phone } = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
  })

  it("counts each event's own stages, officials and participants", async () => {
    const events = await readTenantEvents(adminClient, tenantId)
    const byName = Object.fromEntries(events.map((e) => [e.name, e]))

    expect(Object.keys(byName).sort()).toEqual(['Viadal 2026', 'Viadal 2027'])
    expect(byName['Viadal 2026']).toMatchObject({
      status: 'published',
      stageCount: 2,
      officialsConfirmed: 2,
      officialsInvited: 0,
      participantCount: 0,
    })
    expect(byName['Viadal 2027']).toMatchObject({
      status: 'draft',
      stageCount: 0,
      officialsConfirmed: 1,
      officialsInvited: 1,
      participantCount: 1,
    })
  })

  it("returns nothing for another tenant's id — RLS, not just the filter", async () => {
    expect(await readTenantEvents(adminClient, otherTenantId)).toEqual([])
  })

  it('archives and un-archives through RLS, and the cap refuses a third active event', async () => {
    const archive = await adminClient
      .from('events')
      .update({ status: 'archived' })
      .eq('id', event2027)
      .select('id')
    expect(archive.error).toBeNull()
    expect(archive.data).toHaveLength(1)

    // Premium allows 5; fill the freed slot and three more so un-archiving
    // would make six.
    for (const name of ['A', 'B', 'C', 'D']) await insertEvent(tenantId, name)

    const refused = await adminClient
      .from('events')
      .update({ status: 'draft' })
      .eq('id', event2027)
      .eq('status', 'archived')
      .select('id')
    expect(refused.error?.code).toBe('P0001')

    const { data: still } = await serviceClient()
      .from('events')
      .select('status')
      .eq('id', event2027)
      .single()
    expect(still?.status).toBe('archived')
  })
})

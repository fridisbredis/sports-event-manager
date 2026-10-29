import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { serviceClient, createTenant, cleanupTenant } from './helpers'

// N23 (migration 20261028140031): the three cached admin RPCs take the event
// from the URL. With two events in one tenant, each must answer for the event
// it is given — the dashboard used to raise on a second event, and the event
// and work-area RPCs used to show the oldest one whichever was asked for.
describe('N23: cached admin RPCs read the requested event', () => {
  let tenantId: string
  let event2026: string
  let event2027: string

  async function insertEvent(name: string) {
    const { data, error } = await serviceClient()
      .from('events')
      .insert({ tenant_id: tenantId, name, event_type: 'race' })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  async function addOfficial(name: string, phone: string, status: string, eventIds: string[]) {
    const admin = serviceClient()
    const { data, error } = await admin
      .from('officials')
      .insert({ tenant_id: tenantId, name, phone, invite_status: status })
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
    tenantId = (await createTenant('Cached Per Event')).id
    event2026 = await insertEvent('Viadal 2026')
    event2027 = await insertEvent('Viadal 2027')

    const admin = serviceClient()
    const { error: stageError } = await admin
      .from('event_stages')
      .insert({ tenant_id: tenantId, event_id: event2027, name: 'Day 1', stage_type: 'race' })
    if (stageError) throw stageError
    const { error: wsError } = await admin
      .from('workstations')
      .insert({ tenant_id: tenantId, event_id: event2027, name: 'Finish', capacity_ceiling: 2 })
    if (wsError) throw wsError

    // Two confirmed in 2026 only, one confirmed in both, one invited in 2027.
    await addOfficial('A', '+46704100001', 'confirmed', [event2026])
    await addOfficial('B', '+46704100002', 'confirmed', [event2026])
    await addOfficial('C', '+46704100003', 'confirmed', [event2026, event2027])
    await addOfficial('D', '+46704100004', 'invited', [event2027])
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  function rpc(name: string, eventId?: string) {
    return serviceClient().rpc(
      name as 'get_admin_dashboard_cached',
      eventId ? { p_tenant_id: tenantId, p_event_id: eventId } : { p_tenant_id: tenantId }
    )
  }

  it("answers the dashboard for the requested event, counting that event's officials", async () => {
    const { data, error } = await rpc('get_admin_dashboard_cached', event2027)
    expect(error).toBeNull()
    const d = data as {
      event: { id: string }
      officials_invited: number
      officials_confirmed: number
      race_stage_count: number
    }
    expect(d.event.id).toBe(event2027)
    expect(d.officials_confirmed).toBe(1)
    expect(d.officials_invited).toBe(1)
    expect(d.race_stage_count).toBe(1)

    const other = (await rpc('get_admin_dashboard_cached', event2026)).data as typeof d
    expect(other.event.id).toBe(event2026)
    expect(other.officials_confirmed).toBe(3)
    expect(other.officials_invited).toBe(0)
    expect(other.race_stage_count).toBe(0)
  })

  it('still raises without an event when the tenant has two — the pre-N23 call', async () => {
    const { error } = await rpc('get_admin_dashboard_cached')
    expect(error).not.toBeNull()
  })

  it('answers the event config for the requested event, not the oldest', async () => {
    const { data, error } = await rpc('get_admin_event_cached', event2027)
    expect(error).toBeNull()
    const d = data as { event: { id: string }; stages: unknown[] }
    expect(d.event.id).toBe(event2027)
    expect(d.stages).toHaveLength(1)
  })

  it('answers the work areas for the requested event, not the oldest', async () => {
    const { data, error } = await rpc('get_admin_workstations_cached', event2027)
    expect(error).toBeNull()
    const d = data as { event: { id: string }; workstations: unknown[] }
    expect(d.event.id).toBe(event2027)
    expect(d.workstations).toHaveLength(1)

    const older = (await rpc('get_admin_workstations_cached', event2026)).data as typeof d
    expect(older.workstations).toHaveLength(0)
  })

  it("returns no event for an id from another tenant's event", async () => {
    const otherTenant = (await createTenant('Cached Other')).id
    try {
      const { data: foreign } = await serviceClient()
        .from('events')
        .insert({ tenant_id: otherTenant, name: 'Foreign', event_type: 'race' })
        .select('id')
        .single()
      const { data } = await rpc('get_admin_event_cached', foreign!.id)
      expect((data as { event: unknown }).event).toBeNull()
    } finally {
      await cleanupTenant(otherTenant)
    }
  })
})

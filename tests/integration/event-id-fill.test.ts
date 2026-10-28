import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  createOfficialLinkedToUser,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// N23 expand step (migration 20261028100019): assignments, announcements and
// participants gained a nullable event_id. Deployed code does not write it
// yet, so fill_event_id fills it on insert — from the workstation for an
// assignment, otherwise from the tenant's only event — and the composite FK
// keeps it inside the row's own tenant.
describe('N23: event_id fill on tenant-scoped tables', () => {
  let tenant: { id: string }
  let otherTenant: { id: string }
  let twoEventTenant: { id: string }
  let eventId: string
  let otherEventId: string
  let workstationEventId: string
  let workstationId: string
  let officialId: string
  let clientAdmin: Awaited<ReturnType<typeof signInAsClient>>

  async function insertEvent(tenantId: string, name: string) {
    const { data, error } = await serviceClient()
      .from('events')
      .insert({ tenant_id: tenantId, name, event_type: 'race' })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  beforeAll(async () => {
    tenant = await createTenant('Event Fill')
    otherTenant = await createTenant('Event Fill Other')
    twoEventTenant = await createTenant('Event Fill Two')

    eventId = await insertEvent(tenant.id, 'Only event')
    otherEventId = await insertEvent(otherTenant.id, 'Other tenant event')
    await insertEvent(twoEventTenant.id, 'First')
    await insertEvent(twoEventTenant.id, 'Second')

    // The workstation sits on the SECOND of two events, so the assignment test
    // proves the workstation wins where the sole-event rule would give up.
    const { data: secondEvent } = await serviceClient()
      .from('events')
      .select('id')
      .eq('tenant_id', twoEventTenant.id)
      .eq('name', 'Second')
      .single()
    workstationEventId = secondEvent!.id
    const { data: ws2, error: ws2Error } = await serviceClient()
      .from('workstations')
      .insert({
        tenant_id: twoEventTenant.id,
        event_id: workstationEventId,
        name: 'Finish',
        capacity_ceiling: 1,
      })
      .select('id')
      .single()
    if (ws2Error) throw ws2Error
    workstationId = ws2.id

    const officialUser = await createUserWithRole(twoEventTenant.id, 'official')
    const official = await createOfficialLinkedToUser(
      twoEventTenant.id,
      officialUser.userId,
      'Fill Official'
    )
    officialId = official.id

    const admin = await createUserWithRole(tenant.id, 'tenant_admin')
    clientAdmin = await signInAsClient(admin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
    await cleanupTenant(otherTenant.id)
    await cleanupTenant(twoEventTenant.id)
  })

  function announcement(tenantId: string, extra: Record<string, unknown> = {}) {
    return {
      tenant_id: tenantId,
      channel: 'officials',
      body: 'Hello',
      published_at: new Date().toISOString(),
      ...extra,
    }
  }

  it("fills an announcement from the tenant's only event", async () => {
    const { data, error } = await clientAdmin
      .from('announcements')
      .insert(announcement(tenant.id))
      .select('event_id')
      .single()
    expect(error).toBeNull()
    expect(data?.event_id).toBe(eventId)
  })

  it("fills a participant from the tenant's only event", async () => {
    const { data, error } = await serviceClient()
      .from('participants')
      .insert({ tenant_id: tenant.id, name: 'Runner' })
      .select('event_id')
      .single()
    expect(error).toBeNull()
    expect(data?.event_id).toBe(eventId)
  })

  it('leaves event_id NULL when the tenant has several events', async () => {
    const { data, error } = await serviceClient()
      .from('announcements')
      .insert(announcement(twoEventTenant.id))
      .select('event_id')
      .single()
    expect(error).toBeNull()
    expect(data?.event_id).toBeNull()
  })

  it("fills an assignment from its workstation's event, even with several events", async () => {
    const { data, error } = await serviceClient()
      .from('assignments')
      .insert({
        tenant_id: twoEventTenant.id,
        official_id: officialId,
        workstation_id: workstationId,
        slot_index: 0,
        status: 'assigned',
        timeslot_start: new Date(0).toISOString(),
        timeslot_end: new Date(3600_000).toISOString(),
      })
      .select('event_id')
      .single()
    expect(error).toBeNull()
    expect(data?.event_id).toBe(workstationEventId)
  })

  it('keeps an event_id the writer supplied', async () => {
    const { data: extraEvent } = await serviceClient()
      .from('events')
      .select('id')
      .eq('tenant_id', twoEventTenant.id)
      .eq('name', 'First')
      .single()
    const { data, error } = await serviceClient()
      .from('announcements')
      .insert(announcement(twoEventTenant.id, { event_id: extraEvent!.id }))
      .select('event_id')
      .single()
    expect(error).toBeNull()
    expect(data?.event_id).toBe(extraEvent!.id)
  })

  it('rejects an event_id from another tenant', async () => {
    const { error } = await serviceClient()
      .from('announcements')
      .insert(announcement(tenant.id, { event_id: otherEventId }))
    expect(error?.code).toBe('23503')
  })
})

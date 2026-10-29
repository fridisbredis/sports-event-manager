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

// N23: archiving freezes an event's setup and schedule, not just its row
// (migration 20261029085340). Writes go through a signed-in tenant admin, as
// the app's do; the lock does not depend on who asks.
describe('N23: archive lock on child tables', () => {
  let tenantId: string
  let archivedId: string
  let activeId: string
  let archivedStageId: string
  let archivedWsId: string
  let activeWsId: string
  let officialId: string
  let adminClient: SupabaseClient<Database>

  beforeAll(async () => {
    const admin = serviceClient()
    tenantId = (await createTenant('Archive Lock', 'premium')).id

    const { data: events, error } = await admin
      .from('events')
      .insert([
        { tenant_id: tenantId, name: 'Old', event_type: 'race' },
        { tenant_id: tenantId, name: 'New', event_type: 'race' },
      ])
      .select('id, name')
    if (error) throw error
    archivedId = events.find((e) => e.name === 'Old')!.id
    activeId = events.find((e) => e.name === 'New')!.id

    const { data: stage } = await admin
      .from('event_stages')
      .insert({ tenant_id: tenantId, event_id: archivedId, name: 'Day 1', stage_type: 'race' })
      .select('id')
      .single()
    archivedStageId = stage!.id

    const { data: wss } = await admin
      .from('workstations')
      .insert([
        { tenant_id: tenantId, event_id: archivedId, name: 'Old desk', capacity_ceiling: 2 },
        { tenant_id: tenantId, event_id: activeId, name: 'New desk', capacity_ceiling: 2 },
      ])
      .select('id, name')
    archivedWsId = wss!.find((w) => w.name === 'Old desk')!.id
    activeWsId = wss!.find((w) => w.name === 'New desk')!.id

    const { data: official } = await admin
      .from('officials')
      .insert({ tenant_id: tenantId, name: 'O', phone: '+46704500001', invite_status: 'confirmed' })
      .select('id')
      .single()
    officialId = official!.id

    // A shift in the old event, made while it was still active.
    const { error: shiftError } = await admin.from('assignments').insert({
      tenant_id: tenantId,
      event_id: archivedId,
      official_id: officialId,
      workstation_id: archivedWsId,
      timeslot_start: '2026-06-01T08:00:00+00:00',
      timeslot_end: '2026-06-01T09:00:00+00:00',
      slot_index: 0,
    })
    if (shiftError) throw shiftError

    const { error: archiveError } = await admin
      .from('events')
      .update({ status: 'archived' })
      .eq('id', archivedId)
    if (archiveError) throw archiveError

    const { phone } = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  it.each([
    [
      'adding a stage',
      () =>
        adminClient
          .from('event_stages')
          .insert({ tenant_id: tenantId, event_id: archivedId, name: 'Day 2', stage_type: 'race' }),
    ],
    [
      'renaming a stage',
      () => adminClient.from('event_stages').update({ name: 'Renamed' }).eq('id', archivedStageId),
    ],
    ['deleting a stage', () => adminClient.from('event_stages').delete().eq('id', archivedStageId)],
    [
      'adding a checklist item to a work area',
      () =>
        adminClient
          .from('workstation_todos')
          .insert({ workstation_id: archivedWsId, instruction_text: 'x', item_type: 'info' }),
    ],
    [
      'scheduling a shift',
      () =>
        adminClient.from('assignments').insert({
          tenant_id: tenantId,
          event_id: archivedId,
          official_id: officialId,
          workstation_id: archivedWsId,
          timeslot_start: '2026-06-01T10:00:00+00:00',
          timeslot_end: '2026-06-01T11:00:00+00:00',
          slot_index: 0,
        }),
    ],
    [
      'moving a work area into the archived event',
      () => adminClient.from('workstations').update({ event_id: archivedId }).eq('id', activeWsId),
    ],
    [
      'editing the event row itself',
      () => adminClient.from('events').update({ name: 'Edited' }).eq('id', archivedId),
    ],
  ])('refuses %s with P0004', async (_label, write) => {
    const { error } = await write()
    expect(error?.code).toBe('P0004')
  })

  it('still lets a shift go, so removing a person reaches archived events', async () => {
    const { error } = await adminClient
      .from('assignments')
      .delete()
      .eq('official_id', officialId)
      .eq('event_id', archivedId)
    expect(error).toBeNull()
  })

  it('leaves an active event of the same tenant editable', async () => {
    const { error } = await adminClient
      .from('workstations')
      .update({ name: 'Renamed desk' })
      .eq('id', activeWsId)
    expect(error).toBeNull()
  })

  it('lifts the lock on un-archive', async () => {
    const { error: restoreError } = await adminClient
      .from('events')
      .update({ status: 'draft' })
      .eq('id', archivedId)
    expect(restoreError).toBeNull()

    const { error } = await adminClient
      .from('event_stages')
      .update({ name: 'Renamed' })
      .eq('id', archivedStageId)
    expect(error).toBeNull()
  })

  it('does not stop an archived event from being deleted with everything in it', async () => {
    const admin = serviceClient()
    await admin.from('events').update({ status: 'archived' }).eq('id', archivedId)
    const { error } = await admin.from('events').delete().eq('id', archivedId)
    expect(error).toBeNull()
  })
})

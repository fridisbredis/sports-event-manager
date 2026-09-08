import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTenant, cleanupTenant, serviceClient } from './helpers'

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

    const { error } = await admin.rpc('update_workstation', {
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

    const { data, error } = await admin.rpc('update_workstation', {
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

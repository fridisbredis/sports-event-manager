import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  signInAsClient,
  cleanupTenant,
} from './helpers'

// WS-02/MYSCH-01: checklist check-off is gated entirely by RLS and the
// is_on_workstation_shift() helper (migration 20260930084957). The unit tests
// around the server action mock Supabase, so they can only prove the action
// sends the right query — never that the database would accept or refuse it.
// The whole security model of this feature is "an official may tick only a
// shift they are actually on, but everyone on the shift can see the result",
// and that is only testable against real Postgres.

const SHIFT_START = '2026-10-01T08:00:00+00:00'
const SHIFT_END = '2026-10-01T12:00:00+00:00'
const LATER_SHIFT_START = '2026-10-01T13:00:00+00:00'
const LATER_SHIFT_END = '2026-10-01T17:00:00+00:00'

describe('checklist_item_checks RLS (WS-02)', () => {
  let tenantId: string
  let workstationId: string
  let todoId: string
  let onShiftClient: SupabaseClient<Database>
  let onShiftUserId: string
  let colleagueClient: SupabaseClient<Database>
  let colleagueUserId: string
  let offShiftClient: SupabaseClient<Database>
  let offShiftUserId: string

  beforeAll(async () => {
    const admin = serviceClient()
    const tenant = await createTenant('Checklist RLS Tenant')
    tenantId = tenant.id

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({
        tenant_id: tenantId,
        name: 'Checklist Race',
        event_type: 'race',
        start_date: '2026-10-01',
        end_date: '2026-10-01',
      })
      .select()
      .single()
    if (eventError) throw eventError

    const { data: workstation, error: wsError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantId,
        event_id: event.id,
        name: 'Finish line',
        capacity_ceiling: 5,
        recurring: false,
      })
      .select()
      .single()
    if (wsError) throw wsError
    workstationId = workstation.id

    const { data: todo, error: todoError } = await admin
      .from('workstation_todos')
      .insert({
        workstation_id: workstationId,
        instruction_text: 'Collect timing chips',
        position: 0,
        item_type: 'checkbox',
      })
      .select()
      .single()
    if (todoError) throw todoError
    todoId = todo.id

    // Two officials share the shift; a third is in the tenant but assigned to
    // a different one.
    const onShift = await createUserWithRole(tenantId, 'official')
    onShiftUserId = onShift.userId
    onShiftClient = await signInAsClient(onShift.phone, '000000')

    const colleague = await createUserWithRole(tenantId, 'official')
    colleagueUserId = colleague.userId
    colleagueClient = await signInAsClient(colleague.phone, '000000')

    const offShift = await createUserWithRole(tenantId, 'official')
    offShiftUserId = offShift.userId
    offShiftClient = await signInAsClient(offShift.phone, '000000')

    const officialIdFor = async (userId: string) => {
      const { data } = await admin
        .from('officials')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .single()
      return data!.id
    }

    // Inserted one at a time rather than as one array: PostgREST derives the
    // column list from the FIRST object in a batch, so a batch is only safe
    // when every element has identical keys. Individually also means a
    // failure names the row that caused it.
    const assignmentRows = [
      { userId: onShiftUserId, slot: 0, start: SHIFT_START, end: SHIFT_END },
      { userId: colleagueUserId, slot: 1, start: SHIFT_START, end: SHIFT_END },
      { userId: offShiftUserId, slot: 0, start: LATER_SHIFT_START, end: LATER_SHIFT_END },
    ]

    for (const row of assignmentRows) {
      const { error: assignError } = await admin.from('assignments').insert({
        tenant_id: tenantId,
        official_id: await officialIdFor(row.userId),
        workstation_id: workstationId,
        slot_index: row.slot,
        timeslot_start: row.start,
        timeslot_end: row.end,
        status: 'assigned',
      })
      if (assignError) throw assignError
    }
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  async function clearChecks() {
    const admin = serviceClient()
    await admin.from('checklist_item_checks').delete().eq('tenant_id', tenantId)
    await admin.from('checklist_item_events').delete().eq('tenant_id', tenantId)
  }

  function checkRow(userId: string, start = SHIFT_START, end = SHIFT_END) {
    return {
      tenant_id: tenantId,
      todo_id: todoId,
      workstation_id: workstationId,
      timeslot_start: start,
      timeslot_end: end,
      checked_by: userId,
    }
  }

  it('lets an official on the shift check an item off', async () => {
    await clearChecks()

    const { error } = await onShiftClient
      .from('checklist_item_checks')
      .insert(checkRow(onShiftUserId))

    expect(error).toBeNull()
  })

  it('shows that check to a colleague on the same shift', async () => {
    // The requirement: everyone on the shift sees it. A colleague reading
    // their own empty result here would mean the screen shows work as
    // outstanding that someone has already done.
    const { data, error } = await colleagueClient
      .from('checklist_item_checks')
      .select('checked_by')
      .eq('todo_id', todoId)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].checked_by).toBe(onShiftUserId)
  })

  it('lets a colleague on the same shift uncheck it', async () => {
    const { error } = await colleagueClient
      .from('checklist_item_checks')
      .delete()
      .eq('todo_id', todoId)
      .eq('timeslot_start', SHIFT_START)

    expect(error).toBeNull()

    const { data } = await serviceClient()
      .from('checklist_item_checks')
      .select('id')
      .eq('todo_id', todoId)
    expect(data).toHaveLength(0)
  })

  it('refuses an official who is not on that shift', async () => {
    await clearChecks()

    // Same tenant, same workstation, same item — only the shift differs.
    const { error } = await offShiftClient
      .from('checklist_item_checks')
      .insert(checkRow(offShiftUserId))

    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('refuses a check attributed to someone else', async () => {
    await clearChecks()

    const { error } = await onShiftClient
      .from('checklist_item_checks')
      .insert(checkRow(colleagueUserId))

    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('refuses a second row for the same item on the same shift', async () => {
    await clearChecks()
    await onShiftClient.from('checklist_item_checks').insert(checkRow(onShiftUserId))

    // What makes the action's upsert safe under two simultaneous taps.
    const { error } = await colleagueClient
      .from('checklist_item_checks')
      .insert(checkRow(colleagueUserId))

    expect(error).not.toBeNull()
    expect(error!.code).toBe('23505')
  })

  it('keeps a check on one shift from affecting another', async () => {
    await clearChecks()
    await onShiftClient.from('checklist_item_checks').insert(checkRow(onShiftUserId))

    // The off-shift official's own later shift must still read as unticked —
    // this is the scoping decision the whole feature rests on.
    const { data } = await offShiftClient
      .from('checklist_item_checks')
      .select('id')
      .eq('todo_id', todoId)
      .eq('timeslot_start', LATER_SHIFT_START)

    expect(data).toHaveLength(0)
  })
})

describe('checklist_item_events RLS (WS-02)', () => {
  let tenantId: string
  let workstationId: string
  let todoId: string
  let actorClient: SupabaseClient<Database>
  let actorUserId: string
  let colleagueClient: SupabaseClient<Database>

  beforeAll(async () => {
    const admin = serviceClient()
    const tenant = await createTenant('Checklist Audit Tenant')
    tenantId = tenant.id

    const { data: event } = await admin
      .from('events')
      .insert({
        tenant_id: tenantId,
        name: 'Audit Race',
        event_type: 'race',
        start_date: '2026-10-01',
        end_date: '2026-10-01',
      })
      .select()
      .single()

    const { data: workstation } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantId,
        event_id: event!.id,
        name: 'Water station',
        capacity_ceiling: 5,
        recurring: false,
      })
      .select()
      .single()
    workstationId = workstation!.id

    const { data: todo } = await admin
      .from('workstation_todos')
      .insert({
        workstation_id: workstationId,
        instruction_text: 'Refill jugs',
        position: 0,
        item_type: 'checkbox',
      })
      .select()
      .single()
    todoId = todo!.id

    const actor = await createUserWithRole(tenantId, 'official')
    actorUserId = actor.userId
    actorClient = await signInAsClient(actor.phone, '000000')

    const colleague = await createUserWithRole(tenantId, 'official')
    colleagueClient = await signInAsClient(colleague.phone, '000000')

    const officialIdFor = async (userId: string) => {
      const { data } = await admin
        .from('officials')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .single()
      return data!.id
    }

    const { error: auditAssignError } = await admin.from('assignments').insert([
      {
        tenant_id: tenantId,
        official_id: await officialIdFor(actorUserId),
        workstation_id: workstationId,
        slot_index: 0,
        timeslot_start: SHIFT_START,
        timeslot_end: SHIFT_END,
        status: 'assigned',
      },
    ])
    if (auditAssignError) throw auditAssignError
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  function auditRow(action: 'checked' | 'unchecked') {
    return {
      tenant_id: tenantId,
      todo_id: todoId,
      workstation_id: workstationId,
      timeslot_start: SHIFT_START,
      timeslot_end: SHIFT_END,
      actor_user_id: actorUserId,
      actor_name: 'Test Official',
      action,
    }
  }

  it('records who checked and who unchecked', async () => {
    const { error: checkedError } = await actorClient
      .from('checklist_item_events')
      .insert(auditRow('checked'))
    expect(checkedError).toBeNull()

    const { error: uncheckedError } = await actorClient
      .from('checklist_item_events')
      .insert(auditRow('unchecked'))
    expect(uncheckedError).toBeNull()

    const { data } = await serviceClient()
      .from('checklist_item_events')
      .select('action, actor_user_id, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at')

    expect(data?.map((r) => r.action)).toEqual(['checked', 'unchecked'])
    expect(data?.every((r) => r.actor_user_id === actorUserId)).toBe(true)
  })

  it('is readable by a fellow member, unlike audit_events', async () => {
    // The reason this is its own table: audit_events grants SELECT to admins
    // only, which would hide "who ticked this" from the shift.
    const { data, error } = await colleagueClient
      .from('checklist_item_events')
      .select('action, actor_name')
      .eq('tenant_id', tenantId)

    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
    expect(data![0].actor_name).toBe('Test Official')
  })

  it('cannot be rewritten or deleted by the actor who wrote it', async () => {
    const { error: updateError } = await actorClient
      .from('checklist_item_events')
      .update({ action: 'checked' })
      .eq('tenant_id', tenantId)
    expect(updateError).not.toBeNull()

    const { error: deleteError } = await actorClient
      .from('checklist_item_events')
      .delete()
      .eq('tenant_id', tenantId)
    expect(deleteError).not.toBeNull()

    const { count } = await serviceClient()
      .from('checklist_item_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    expect(count).toBe(2)
  })
})

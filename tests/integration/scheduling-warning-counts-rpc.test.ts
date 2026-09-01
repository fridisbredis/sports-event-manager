import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// scheduling_warning_counts (supabase/migrations/0040) backs the admin
// dashboard's "Over capacity" / "Double-booked" tile. It used to be
// hardcoded to 0/0 with no query at all. These tests cover:
//   - the counts match src/lib/scheduling/grid-logic.ts's own semantics
//     (distinct workstations/officials flagged, not one count per slot)
//   - tenant isolation: a caller in tenant A never sees tenant B's warnings
//   - the auth path: `assignments` has only a FOR ALL tenant_admin policy, no
//     separate member-read policy, so a non-admin caller must see 0/0
//     (RLS-filtered), not an error and not another tenant's real counts
//   - earliest_timeslot_start/earliest_stage_id/earliest_day identify where
//     the chronologically-first warning is, so the dashboard's "review this
//     warning" link can jump straight to the right stage and day
describe('scheduling_warning_counts RPC', () => {
  const T1 = new Date('2026-09-20T10:00:00.000Z').toISOString()
  const T1_END = new Date('2026-09-20T10:30:00.000Z').toISOString()
  const EARLY_T = new Date('2026-09-10T08:00:00.000Z').toISOString()
  const EARLY_T_END = new Date('2026-09-10T08:30:00.000Z').toISOString()

  let tenantA: { id: string }
  let tenantB: { id: string }
  let eventA: { id: string }
  let stageA: { id: string }
  let workstationA: { id: string; capacity_ceiling: number }
  let workstationA2: { id: string }
  let workstationB: { id: string }
  let officials: { id: string }[]
  let officialB: { id: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>
  let clientOfficialA: Awaited<ReturnType<typeof signInAsClient>>

  async function seedAssignment(fields: {
    tenantId: string
    officialId: string
    workstationId: string
    slotIndex: number
    timeslotStart?: string
    timeslotEnd?: string
  }) {
    const admin = serviceClient()
    const { error } = await admin.from('assignments').insert({
      tenant_id: fields.tenantId,
      official_id: fields.officialId,
      workstation_id: fields.workstationId,
      timeslot_start: fields.timeslotStart ?? T1,
      timeslot_end: fields.timeslotEnd ?? T1_END,
      slot_index: fields.slotIndex,
      status: 'assigned',
    })
    if (error) throw error
  }

  async function deleteAllAssignments(tenantId: string) {
    const admin = serviceClient()
    const { error } = await admin.from('assignments').delete().eq('tenant_id', tenantId)
    if (error) throw error
  }

  // PostgREST formats a timestamptz as "...+00:00", not the "...Z" that
  // Date#toISOString() (used to build the T1/EARLY_T fixtures) produces —
  // same instant, different string. Compare as Date so the assertions below
  // aren't sensitive to that formatting difference.
  function normalizeWarningCounts(row: {
    over_capacity: number
    double_booked: number
    earliest_timeslot_start: string | null
    earliest_stage_id: string | null
    earliest_day: string | null
  }) {
    return {
      ...row,
      earliest_timeslot_start: row.earliest_timeslot_start
        ? new Date(row.earliest_timeslot_start).toISOString()
        : null,
    }
  }

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A SchedWarnings')
    tenantB = await createTenant('Tenant B SchedWarnings')

    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')

    const officialUserA = await createUserWithRole(tenantA.id, 'official')
    clientOfficialA = await signInAsClient(officialUserA.phone, '000000')

    const admin = serviceClient()

    const { data: eventARow, error: eventAError } = await admin
      .from('events')
      .insert({ tenant_id: tenantA.id, name: 'SchedWarnings Event A', event_type: 'race' })
      .select()
      .single()
    if (eventAError) throw eventAError
    eventA = eventARow

    const { data: stageARow, error: stageAError } = await admin
      .from('event_stages')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA.id,
        name: 'SchedWarnings Stage A',
        stage_date: '2026-09-20',
      })
      .select()
      .single()
    if (stageAError) throw stageAError
    stageA = stageARow

    const { data: wsA, error: wsAError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA.id,
        stage_id: stageA.id,
        name: 'SchedWarnings WS A',
        capacity_ceiling: 2,
      })
      .select()
      .single()
    if (wsAError) throw wsAError
    workstationA = wsA

    const { data: wsA2, error: wsA2Error } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA.id,
        stage_id: stageA.id,
        name: 'SchedWarnings WS A2',
        capacity_ceiling: 5,
      })
      .select()
      .single()
    if (wsA2Error) throw wsA2Error
    workstationA2 = wsA2

    const { data: eventB, error: eventBError } = await admin
      .from('events')
      .insert({ tenant_id: tenantB.id, name: 'SchedWarnings Event B', event_type: 'race' })
      .select()
      .single()
    if (eventBError) throw eventBError

    const { data: wsB, error: wsBError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantB.id,
        event_id: eventB.id,
        name: 'SchedWarnings WS B',
        capacity_ceiling: 1,
      })
      .select()
      .single()
    if (wsBError) throw wsBError
    workstationB = wsB

    const officialRows = []
    for (let i = 0; i < 3; i++) {
      const { data, error } = await admin
        .from('officials')
        .insert({
          tenant_id: tenantA.id,
          name: `SchedWarnings Official A${i}`,
          phone: `+46704${Math.floor(Math.random() * 1_000_000)}`,
          invite_status: 'confirmed',
        })
        .select()
        .single()
      if (error) throw error
      officialRows.push(data)
    }
    officials = officialRows

    const { data: officialBRow, error: officialBError } = await admin
      .from('officials')
      .insert({
        tenant_id: tenantB.id,
        name: 'SchedWarnings Official B',
        phone: `+46704${Math.floor(Math.random() * 1_000_000)}`,
        invite_status: 'confirmed',
      })
      .select()
      .single()
    if (officialBError) throw officialBError
    officialB = officialBRow
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  function noWarnings() {
    return {
      over_capacity: 0,
      double_booked: 0,
      earliest_timeslot_start: null,
      earliest_stage_id: null,
      earliest_day: null,
    }
  }

  it('returns 0/0 and no earliest-warning location when there are no assignments', async () => {
    const { data, error } = await clientAdminA.rpc('scheduling_warning_counts', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
    })

    expect(error).toBeNull()
    expect(data?.map(normalizeWarningCounts)).toEqual([noWarnings()])
  })

  it('flags a workstation once when its assignment count exceeds capacity_ceiling, and reports where', async () => {
    // capacity_ceiling is 2 — three officials at the same slot is over.
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: workstationA.id,
      slotIndex: 0,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[1].id,
      workstationId: workstationA.id,
      slotIndex: 1,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[2].id,
      workstationId: workstationA.id,
      slotIndex: 2,
    })

    const { data, error } = await clientAdminA.rpc('scheduling_warning_counts', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
    })

    expect(error).toBeNull()
    expect(data?.map(normalizeWarningCounts)).toEqual([
      {
        over_capacity: 1,
        double_booked: 0,
        earliest_timeslot_start: T1,
        earliest_stage_id: stageA.id,
        earliest_day: '2026-09-20',
      },
    ])

    await deleteAllAssignments(tenantA.id)
  })

  it('does not flag a workstation at or below capacity_ceiling', async () => {
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: workstationA.id,
      slotIndex: 0,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[1].id,
      workstationId: workstationA.id,
      slotIndex: 1,
    })

    const { data } = await clientAdminA.rpc('scheduling_warning_counts', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
    })

    expect(data?.map(normalizeWarningCounts)).toEqual([noWarnings()])

    await deleteAllAssignments(tenantA.id)
  })

  it('flags an official once when booked to two workstations at the same timeslot, and reports where', async () => {
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: workstationA.id,
      slotIndex: 0,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: workstationA2.id,
      slotIndex: 0,
    })

    const { data, error } = await clientAdminA.rpc('scheduling_warning_counts', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
    })

    expect(error).toBeNull()
    expect(data?.map(normalizeWarningCounts)).toEqual([
      {
        over_capacity: 0,
        double_booked: 1,
        earliest_timeslot_start: T1,
        // Both workstations belong to the same stage in this fixture, so the
        // "arbitrary pick" the migration documents is unambiguous here.
        earliest_stage_id: stageA.id,
        earliest_day: '2026-09-20',
      },
    ])

    await deleteAllAssignments(tenantA.id)
  })

  it('does not flag the same official at the same workstation twice (no-op resave)', async () => {
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: workstationA.id,
      slotIndex: 0,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: workstationA.id,
      slotIndex: 1,
    })

    const { data } = await clientAdminA.rpc('scheduling_warning_counts', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
    })

    // Two rows on the SAME workstation is what over-capacity is for, not
    // double-booking — this asserts double_booked specifically stays 0.
    expect(data?.map(normalizeWarningCounts)).toEqual([noWarnings()])

    await deleteAllAssignments(tenantA.id)
  })

  it('reports the chronologically earliest warning when there are several, regardless of insert order', async () => {
    // Over-capacity later (T1, 2026-09-20) inserted BEFORE the double-booking
    // earlier (EARLY_T, 2026-09-10) — asserts the RPC orders by time, not by
    // insertion or by warning type.
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: workstationA.id,
      slotIndex: 0,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[1].id,
      workstationId: workstationA.id,
      slotIndex: 1,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[2].id,
      workstationId: workstationA.id,
      slotIndex: 2,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: workstationA2.id,
      slotIndex: 0,
      timeslotStart: EARLY_T,
      timeslotEnd: EARLY_T_END,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: workstationA.id,
      slotIndex: 3,
      timeslotStart: EARLY_T,
      timeslotEnd: EARLY_T_END,
    })

    const { data, error } = await clientAdminA.rpc('scheduling_warning_counts', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
    })

    expect(error).toBeNull()
    expect(data?.map(normalizeWarningCounts)).toEqual([
      {
        over_capacity: 1,
        double_booked: 1,
        earliest_timeslot_start: EARLY_T,
        earliest_stage_id: stageA.id,
        earliest_day: '2026-09-10',
      },
    ])

    await deleteAllAssignments(tenantA.id)
  })

  it("does not count another tenant's warnings", async () => {
    // Tenant B: capacity_ceiling 1, two officials at the same slot -> over.
    await seedAssignment({
      tenantId: tenantB.id,
      officialId: officialB.id,
      workstationId: workstationB.id,
      slotIndex: 0,
    })
    const admin = serviceClient()
    const { error: secondOfficialError } = await admin.from('officials').insert({
      tenant_id: tenantB.id,
      name: 'SchedWarnings Official B2',
      phone: `+46704${Math.floor(Math.random() * 1_000_000)}`,
      invite_status: 'confirmed',
    })
    if (secondOfficialError) throw secondOfficialError

    const { data, error } = await clientAdminA.rpc('scheduling_warning_counts', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
    })

    expect(error).toBeNull()
    expect(data?.map(normalizeWarningCounts)).toEqual([noWarnings()])

    await deleteAllAssignments(tenantB.id)
  })

  it("does not count another event's warnings within the same tenant", async () => {
    // A second event in tenant A, with its own stage/workstation, seeded
    // with an over-capacity warning of its own. p_event_id must scope the
    // counts (and earliest_stage_id/earliest_day) to eventA only — a leak
    // here would resolve to a stage the scheduling page can't find for
    // eventA, landing the grid on getCurrentStage/today instead of the
    // warning it's supposed to jump to.
    const admin = serviceClient()

    const { data: eventA2, error: eventA2Error } = await admin
      .from('events')
      .insert({ tenant_id: tenantA.id, name: 'SchedWarnings Event A2', event_type: 'race' })
      .select()
      .single()
    if (eventA2Error) throw eventA2Error

    const { data: stageA2, error: stageA2Error } = await admin
      .from('event_stages')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA2.id,
        name: 'SchedWarnings Stage A2',
        stage_date: '2026-09-15',
      })
      .select()
      .single()
    if (stageA2Error) throw stageA2Error

    const { data: wsA2Event, error: wsA2EventError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA2.id,
        stage_id: stageA2.id,
        name: 'SchedWarnings WS A2-Event',
        capacity_ceiling: 1,
      })
      .select()
      .single()
    if (wsA2EventError) throw wsA2EventError

    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: wsA2Event.id,
      slotIndex: 0,
      timeslotStart: EARLY_T,
      timeslotEnd: EARLY_T_END,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[1].id,
      workstationId: wsA2Event.id,
      slotIndex: 1,
      timeslotStart: EARLY_T,
      timeslotEnd: EARLY_T_END,
    })

    const { data, error } = await clientAdminA.rpc('scheduling_warning_counts', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
    })

    expect(error).toBeNull()
    expect(data?.map(normalizeWarningCounts)).toEqual([noWarnings()])

    await deleteAllAssignments(tenantA.id)
    await admin.from('workstations').delete().eq('id', wsA2Event.id)
    await admin.from('event_stages').delete().eq('id', stageA2.id)
    await admin.from('events').delete().eq('id', eventA2.id)
  })

  it('returns 0/0 for a non-admin caller instead of an error (RLS-filtered, not authorized)', async () => {
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[0].id,
      workstationId: workstationA.id,
      slotIndex: 0,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[1].id,
      workstationId: workstationA.id,
      slotIndex: 1,
    })
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officials[2].id,
      workstationId: workstationA.id,
      slotIndex: 2,
    })

    const { data, error } = await clientOfficialA.rpc('scheduling_warning_counts', {
      p_tenant_id: tenantA.id,
      p_event_id: eventA.id,
    })

    expect(error).toBeNull()
    expect(data?.map(normalizeWarningCounts)).toEqual([noWarnings()])

    await deleteAllAssignments(tenantA.id)
  })
})

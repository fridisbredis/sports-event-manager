import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  createSystemAdmin,
  deleteAuthUser,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// PERF-02: save_assignments_batch (supabase/migrations/0030) replaced four
// sequential Supabase calls with one transaction. These tests cover the two
// things that change made load-bearing:
//   - the RPC is a new `grant execute ... to authenticated` surface, so its
//     own authorization check has to hold for a foreign tenant and for a
//     non-admin role
//   - the whole point of the ticket is that a failed addition rolls back the
//     deletions and status updates that ran before it. Both routes to that
//     rollback are exercised: the in-batch occupancy check, and the
//     migration-0012 unique constraint at insert time.
describe('PERF-02: save_assignments_batch', () => {
  const T1 = new Date('2026-09-01T08:00:00.000Z').toISOString()
  const T1_END = new Date('2026-09-01T09:00:00.000Z').toISOString()
  // A second timeslot, used only by the unique_violation path so its
  // cross-tenant fixture row cannot interfere with the in-batch path.
  const T2 = new Date('2026-09-01T10:00:00.000Z').toISOString()
  const T2_END = new Date('2026-09-01T11:00:00.000Z').toISOString()

  // A third timeslot, used by the auto-assign tests so their rows cannot
  // collide with the fixtures of the two rollback paths above.
  const T3 = new Date('2026-09-01T12:00:00.000Z').toISOString()
  const T3_END = new Date('2026-09-01T13:00:00.000Z').toISOString()

  let tenantA: { id: string }
  let tenantB: { id: string }
  let workstationA: { id: string }
  let workstationB: { id: string }
  let officialA1: { id: string }
  let officialA2: { id: string }
  let officialB: { id: string }
  let systemAdminUserId: string
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>
  let clientOfficialA: Awaited<ReturnType<typeof signInAsClient>>
  let clientSystemAdmin: Awaited<ReturnType<typeof signInAsClient>>

  // Assignment rows are per-test, since every test mutates or asserts on
  // them. Created via the service client so RLS is not part of what is under
  // test here.
  async function seedAssignment(fields: {
    tenantId: string
    officialId: string
    workstationId: string | null
    timeslotStart: string
    timeslotEnd: string
    slotIndex: number
    status?: string
  }) {
    const admin = serviceClient()
    const { data, error } = await admin
      .from('assignments')
      .insert({
        tenant_id: fields.tenantId,
        official_id: fields.officialId,
        workstation_id: fields.workstationId,
        timeslot_start: fields.timeslotStart,
        timeslot_end: fields.timeslotEnd,
        slot_index: fields.slotIndex,
        status: fields.status ?? 'assigned',
      })
      .select()
      .single()
    if (error) throw error
    return data
  }

  async function readAssignment(id: string) {
    const admin = serviceClient()
    const { data } = await admin
      .from('assignments')
      .select('id, status, slot_index')
      .eq('id', id)
      .maybeSingle()
    return data
  }

  async function countAssignments(tenantId: string) {
    const admin = serviceClient()
    const { count, error } = await admin
      .from('assignments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    if (error) throw error
    return count ?? 0
  }

  async function deleteAllAssignments(tenantId: string) {
    const admin = serviceClient()
    const { error } = await admin.from('assignments').delete().eq('tenant_id', tenantId)
    if (error) throw error
  }

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A Perf02')
    tenantB = await createTenant('Tenant B Perf02')

    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')

    const officialUserA = await createUserWithRole(tenantA.id, 'official')
    clientOfficialA = await signInAsClient(officialUserA.phone, '000000')

    const sysAdmin = await createSystemAdmin()
    systemAdminUserId = sysAdmin.userId
    clientSystemAdmin = await signInAsClient(sysAdmin.phone, '000000')

    const admin = serviceClient()

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({ tenant_id: tenantA.id, name: 'Perf02 Event', event_type: 'race' })
      .select()
      .single()
    if (eventError) throw eventError

    const { data: ws, error: wsError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantA.id,
        event_id: event.id,
        name: 'Perf02 Workstation',
        capacity_ceiling: 6,
      })
      .select()
      .single()
    if (wsError) throw wsError
    workstationA = ws

    // Tenant B needs its own event + workstation so the cross-tenant
    // workstation_id guard has a real foreign workstation to reject. Without
    // this the only available "foreign" id would be a random uuid, which the
    // guard rejects for the wrong reason (nonexistent, not foreign).
    const { data: eventB, error: eventBError } = await admin
      .from('events')
      .insert({ tenant_id: tenantB.id, name: 'Perf02 Event B', event_type: 'race' })
      .select()
      .single()
    if (eventBError) throw eventBError

    const { data: wsB, error: wsBError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantB.id,
        event_id: eventB.id,
        name: 'Perf02 Workstation B',
        capacity_ceiling: 6,
      })
      .select()
      .single()
    if (wsBError) throw wsBError
    workstationB = wsB

    // officials rows with user_id null — the schema allows it (an official is
    // unlinked until they accept the SMS invite) and it keeps the fixed
    // test-OTP phone pool free for the two signed-in clients above.
    const officialRows = []
    for (const row of [
      { tenant_id: tenantA.id, name: 'Perf02 Official A1' },
      { tenant_id: tenantA.id, name: 'Perf02 Official A2' },
      { tenant_id: tenantB.id, name: 'Perf02 Official B' },
    ]) {
      const { data, error } = await admin
        .from('officials')
        .insert({
          ...row,
          phone: `+46703${Math.floor(Math.random() * 1_000_000)}`,
          invite_status: 'confirmed',
        })
        .select()
        .single()
      if (error) throw error
      officialRows.push(data)
    }
    officialA1 = officialRows[0]
    officialA2 = officialRows[1]
    officialB = officialRows[2]
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
    // Not tracked by cleanupTenant — a system_admin has no tenant_id.
    await deleteAuthUser(systemAdminUserId)
  })

  it('commits a valid batch — deletion, status update and addition all applied', async () => {
    const toDelete = await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA1.id,
      workstationId: workstationA.id,
      timeslotStart: T1,
      timeslotEnd: T1_END,
      slotIndex: 1,
    })
    const toUpdate = await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA2.id,
      workstationId: workstationA.id,
      timeslotStart: T1,
      timeslotEnd: T1_END,
      slotIndex: 2,
    })

    const { data, error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [toDelete.id],
      p_status_updates: [{ id: toUpdate.id, status: 'blocked' }],
      p_additions: [
        {
          official_id: officialA1.id,
          workstation_id: workstationA.id,
          timeslot_start: T1,
          timeslot_end: T1_END,
          slot_index: 3,
        },
      ],
    })

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(await readAssignment(toDelete.id)).toBeNull()
    expect((await readAssignment(toUpdate.id))?.status).toBe('blocked')

    await deleteAllAssignments(tenantA.id)
  })

  it('rejects a caller acting on another tenant with ASG02 and writes nothing', async () => {
    const rowB = await seedAssignment({
      tenantId: tenantB.id,
      officialId: officialB.id,
      workstationId: null,
      timeslotStart: T1,
      timeslotEnd: T1_END,
      slotIndex: 1,
      status: 'available',
    })
    const countBefore = await countAssignments(tenantB.id)

    const { error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantB.id,
      p_deletions: [rowB.id],
      p_status_updates: [{ id: rowB.id, status: 'blocked' }],
      p_additions: [],
    })

    expect(error?.code).toBe('ASG02')
    expect(await readAssignment(rowB.id)).not.toBeNull()
    expect((await readAssignment(rowB.id))?.status).toBe('available')
    expect(await countAssignments(tenantB.id)).toBe(countBefore)

    await deleteAllAssignments(tenantB.id)
  })

  it('rejects a non-admin role in its own tenant with ASG02 and writes nothing', async () => {
    const row = await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA1.id,
      workstationId: workstationA.id,
      timeslotStart: T1,
      timeslotEnd: T1_END,
      slotIndex: 1,
    })
    const countBefore = await countAssignments(tenantA.id)

    const { error } = await clientOfficialA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [row.id],
      p_status_updates: [],
      p_additions: [
        {
          official_id: officialA1.id,
          workstation_id: workstationA.id,
          timeslot_start: T1,
          timeslot_end: T1_END,
          slot_index: 2,
        },
      ],
    })

    expect(error?.code).toBe('ASG02')
    expect(await readAssignment(row.id)).not.toBeNull()
    expect(await countAssignments(tenantA.id)).toBe(countBefore)

    await deleteAllAssignments(tenantA.id)
  })

  // Path A — the in-batch occupancy check raises before the insert is ever
  // attempted. This is the case the old sequential code got wrong: the
  // deletion and status update had already been committed by separate
  // network calls by the time the insert step failed.
  it('rolls the whole batch back when the in-batch occupancy check rejects an addition (ASG01)', async () => {
    const occupied = await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA1.id,
      workstationId: workstationA.id,
      timeslotStart: T1,
      timeslotEnd: T1_END,
      slotIndex: 1,
    })
    const toDelete = await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA2.id,
      workstationId: workstationA.id,
      timeslotStart: T1,
      timeslotEnd: T1_END,
      slotIndex: 2,
    })
    const toUpdate = await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA1.id,
      workstationId: workstationA.id,
      timeslotStart: T1,
      timeslotEnd: T1_END,
      slotIndex: 3,
    })
    const countBefore = await countAssignments(tenantA.id)

    const { error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [toDelete.id],
      p_status_updates: [{ id: toUpdate.id, status: 'blocked' }],
      p_additions: [
        {
          official_id: officialA2.id,
          workstation_id: workstationA.id,
          timeslot_start: T1,
          timeslot_end: T1_END,
          // Already held by `occupied` — the occupancy map catches this.
          slot_index: 1,
        },
      ],
    })

    expect(error?.code).toBe('ASG01')
    expect(await readAssignment(toDelete.id)).not.toBeNull()
    expect((await readAssignment(toUpdate.id))?.status).toBe('assigned')
    expect(await readAssignment(occupied.id)).not.toBeNull()
    expect(await countAssignments(tenantA.id)).toBe(countBefore)

    await deleteAllAssignments(tenantA.id)
  })

  // Path B — reaches the INSERT and trips
  // uq_assignments_workstation_timeslot_slot (migration 0012), exercising the
  // `when unique_violation` handler rather than the in-batch check. The
  // constraint is on (workstation_id, timeslot_start, slot_index) with no
  // tenant_id, while the occupancy read is filtered to p_tenant_id — so a row
  // belonging to another tenant on the same workstation is invisible to the
  // check and only surfaces at insert time.
  //
  // The foreign row is seeded with the service client on purpose. The RPC no
  // longer accepts a foreign workstation_id (see the ASG03 tests below), so
  // this row can no longer be created through it — but rows like it can still
  // exist from before that guard, or from any other writer, and the
  // unique_violation handler is what has to cope. Seeding directly is what
  // keeps this test about the handler instead of about the guard.
  it('rolls the whole batch back when the insert trips the unique constraint (ASG01)', async () => {
    const foreignRow = await seedAssignment({
      tenantId: tenantB.id,
      officialId: officialB.id,
      workstationId: workstationA.id,
      timeslotStart: T2,
      timeslotEnd: T2_END,
      slotIndex: 1,
    })
    const toDelete = await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA1.id,
      workstationId: workstationA.id,
      timeslotStart: T2,
      timeslotEnd: T2_END,
      slotIndex: 4,
    })
    const toUpdate = await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA2.id,
      workstationId: workstationA.id,
      timeslotStart: T2,
      timeslotEnd: T2_END,
      slotIndex: 5,
    })
    const countBefore = await countAssignments(tenantA.id)

    const { error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [toDelete.id],
      p_status_updates: [{ id: toUpdate.id, status: 'blocked' }],
      p_additions: [
        {
          official_id: officialA1.id,
          workstation_id: workstationA.id,
          timeslot_start: T2,
          timeslot_end: T2_END,
          // Free as far as tenant A's occupancy read can see; taken by
          // tenant B's row at the constraint level.
          slot_index: 1,
        },
      ],
    })

    expect(error?.code).toBe('ASG01')
    expect(await readAssignment(toDelete.id)).not.toBeNull()
    expect((await readAssignment(toUpdate.id))?.status).toBe('assigned')
    expect(await readAssignment(foreignRow.id)).not.toBeNull()
    expect(await countAssignments(tenantA.id)).toBe(countBefore)

    await deleteAllAssignments(tenantA.id)
    await deleteAllAssignments(tenantB.id)
  })

  // Guards the set-based officials check added for FIX 2b.
  it("rejects an addition naming another tenant's official with ASG03 and writes nothing", async () => {
    const toDelete = await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA1.id,
      workstationId: workstationA.id,
      timeslotStart: T1,
      timeslotEnd: T1_END,
      slotIndex: 1,
    })
    const countBefore = await countAssignments(tenantA.id)

    const { error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [toDelete.id],
      p_status_updates: [],
      p_additions: [
        {
          official_id: officialB.id,
          workstation_id: workstationA.id,
          timeslot_start: T1,
          timeslot_end: T1_END,
          slot_index: 2,
        },
      ],
    })

    expect(error?.code).toBe('ASG03')
    expect(await readAssignment(toDelete.id)).not.toBeNull()
    expect(await countAssignments(tenantA.id)).toBe(countBefore)

    await deleteAllAssignments(tenantA.id)
  })

  // Guards the null-key guard added for FIX 1a. Before it, this payload made
  // the auto-assign loop spin forever inside an open transaction — the test
  // would hang rather than fail.
  it('rejects an addition with a null workstation_id with ASG03 rather than looping', async () => {
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA1.id,
      workstationId: workstationA.id,
      timeslotStart: T1,
      timeslotEnd: T1_END,
      slotIndex: 1,
    })
    const countBefore = await countAssignments(tenantA.id)

    const { error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: [
        {
          official_id: officialA1.id,
          workstation_id: null,
          timeslot_start: T1,
          timeslot_end: T1_END,
        },
      ],
    })

    expect(error?.code).toBe('ASG03')
    expect(await countAssignments(tenantA.id)).toBe(countBefore)

    await deleteAllAssignments(tenantA.id)
  })

  // ------------------------------------------------------------------------
  // Cross-tenant workstation_id.
  //
  // Same defect class as the official_id test above, but with a worse
  // consequence. assignments.workstation_id has no tenant-consistency
  // constraint, and uq_assignments_workstation_timeslot_slot (migration 0012)
  // is UNIQUE (workstation_id, timeslot_start, slot_index) with no tenant_id
  // column. So without this guard, an admin of tenant A could write a row
  // owned by A that occupies a slot on tenant B's workstation: B's admins
  // then get "someone else just took that slot" for a slot their own grid
  // shows as free, and they can neither see nor delete the row holding it.
  // No RLS policy is violated anywhere in that sequence, which is why RLS
  // alone was never going to catch it.
  // ------------------------------------------------------------------------
  it("rejects an addition naming another tenant's workstation with ASG03 and writes nothing", async () => {
    const toDelete = await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA1.id,
      workstationId: workstationA.id,
      timeslotStart: T1,
      timeslotEnd: T1_END,
      slotIndex: 1,
    })
    const countBefore = await countAssignments(tenantA.id)
    const countBeforeB = await countAssignments(tenantB.id)

    const { error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [toDelete.id],
      p_status_updates: [],
      p_additions: [
        {
          official_id: officialA1.id,
          workstation_id: workstationB.id,
          timeslot_start: T1,
          timeslot_end: T1_END,
          slot_index: 1,
        },
      ],
    })

    expect(error?.code).toBe('ASG03')
    // The deletion in the same batch must have rolled back with it.
    expect(await readAssignment(toDelete.id)).not.toBeNull()
    expect(await countAssignments(tenantA.id)).toBe(countBefore)
    // And nothing landed against tenant B's workstation.
    expect(await countAssignments(tenantB.id)).toBe(countBeforeB)

    await deleteAllAssignments(tenantA.id)
  })

  // The tenant_admin version of the test above passes for two independent
  // reasons: the explicit tenant check, and RLS on `workstations` hiding
  // tenant B's row from a tenant A admin. A system_admin can read every
  // tenant's workstations, so RLS is not a factor here and only the explicit
  // `w.tenant_id = p_tenant_id` check can reject this. That makes this the
  // test that actually pins the guard.
  it("rejects a system_admin writing another tenant's workstation into this tenant (ASG03)", async () => {
    const countBefore = await countAssignments(tenantA.id)

    const { error } = await clientSystemAdmin.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: [
        {
          official_id: officialA1.id,
          workstation_id: workstationB.id,
          timeslot_start: T1,
          timeslot_end: T1_END,
          slot_index: 1,
        },
      ],
    })

    expect(error?.code).toBe('ASG03')
    expect(await countAssignments(tenantA.id)).toBe(countBefore)

    await deleteAllAssignments(tenantA.id)
  })

  // The function is SECURITY INVOKER, so the system_admin path depends on the
  // is_system_admin() arm of both its own auth check and migration 0004's RLS
  // policies. A system_admin normally has no user_roles row for the tenant
  // being written, so if either arm regressed this would fail closed with
  // ASG02 — silently, since no app screen exercises it.
  it('lets a system_admin commit a batch in a tenant it has no explicit role in', async () => {
    const { data, error } = await clientSystemAdmin.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: [
        {
          official_id: officialA1.id,
          workstation_id: workstationA.id,
          timeslot_start: T3,
          timeslot_end: T3_END,
          slot_index: 1,
        },
      ],
    })

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(await countAssignments(tenantA.id)).toBe(1)

    await deleteAllAssignments(tenantA.id)
  })

  // ------------------------------------------------------------------------
  // Auto-assign (addition with no slot_index -> next free slot).
  //
  // No app call site reaches this branch today — all four persistAdditions
  // calls in scheduling-grid.tsx pass an explicit slot_index. It is kept
  // because it mirrors intentional pre-migration TS behavior (`nextFreeSlot`)
  // and retiring it is a product decision. Keeping it means testing it: it is
  // the hardest-to-port logic in migration 0030 and the only loop in it.
  // ------------------------------------------------------------------------
  it('auto-assigns an addition with no slot_index to the next free index', async () => {
    await seedAssignment({
      tenantId: tenantA.id,
      officialId: officialA1.id,
      workstationId: workstationA.id,
      timeslotStart: T3,
      timeslotEnd: T3_END,
      slotIndex: 1,
    })

    const { data, error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: [
        {
          official_id: officialA2.id,
          workstation_id: workstationA.id,
          timeslot_start: T3,
          timeslot_end: T3_END,
        },
      ],
    })

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0].slot_index).toBe(2)

    await deleteAllAssignments(tenantA.id)
  })

  // The distinction that matters: "next free" is the first gap, not one past
  // the highest. A max()+1 implementation passes the test above and fails
  // this one.
  it('auto-assigns into a gap rather than past the highest occupied index', async () => {
    for (const slotIndex of [1, 3]) {
      await seedAssignment({
        tenantId: tenantA.id,
        officialId: officialA1.id,
        workstationId: workstationA.id,
        timeslotStart: T3,
        timeslotEnd: T3_END,
        slotIndex,
      })
    }

    const { data, error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: [
        {
          official_id: officialA2.id,
          workstation_id: workstationA.id,
          timeslot_start: T3,
          timeslot_end: T3_END,
        },
      ],
    })

    expect(error).toBeNull()
    expect(data?.[0].slot_index).toBe(2)

    await deleteAllAssignments(tenantA.id)
  })

  // Covers the running-occupancy-map mutation: each addition in the batch has
  // to see the slots the earlier ones in the same batch just claimed. If the
  // map were rebuilt per row (or read once and not mutated) all three would
  // pick slot 1 and the insert would trip the 0012 unique constraint.
  it('auto-assigns several additions in one batch to consecutive free indexes', async () => {
    const addition = {
      official_id: officialA1.id,
      workstation_id: workstationA.id,
      timeslot_start: T3,
      timeslot_end: T3_END,
    }

    const { data, error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: [addition, addition, addition],
    })

    expect(error).toBeNull()
    expect(data?.map((r) => r.slot_index).sort((a, b) => a - b)).toEqual([1, 2, 3])

    await deleteAllAssignments(tenantA.id)
  })

  // An explicit slot_index and an auto-assigned one in the same batch have to
  // share one occupancy map — the auto-assigned row must not land on the slot
  // the explicit one claimed earlier in the same array.
  it('does not auto-assign onto a slot claimed by an explicit slot_index in the same batch', async () => {
    const { data, error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: [
        {
          official_id: officialA1.id,
          workstation_id: workstationA.id,
          timeslot_start: T3,
          timeslot_end: T3_END,
          slot_index: 1,
        },
        {
          official_id: officialA2.id,
          workstation_id: workstationA.id,
          timeslot_start: T3,
          timeslot_end: T3_END,
        },
      ],
    })

    expect(error).toBeNull()
    expect(data?.map((r) => r.slot_index).sort((a, b) => a - b)).toEqual([1, 2])

    await deleteAllAssignments(tenantA.id)
  })

  // ------------------------------------------------------------------------
  // Payload ceilings and shape.
  //
  // These live in the RPC rather than only in the Server Action's zod schemas
  // because the function is granted to `authenticated`: any logged-in user
  // can POST /rest/v1/rpc/save_assignments_batch with their own JWT and skip
  // actions.ts entirely. RLS still confines what they can write to their own
  // tenant, so what is left to defend against is an unbounded transaction and
  // a raw Postgres error reaching a client.
  // ------------------------------------------------------------------------
  it('rejects an over-cap additions array with ASG04, distinct from ASG03', async () => {
    const additions = Array.from({ length: 501 }, (_, i) => ({
      official_id: officialA1.id,
      workstation_id: workstationA.id,
      timeslot_start: T3,
      timeslot_end: T3_END,
      slot_index: i + 1,
    }))

    const { error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: additions,
    })

    // Distinct from ASG03 on purpose — "too big, split it" and "your payload
    // is malformed" have different fixes.
    expect(error?.code).toBe('ASG04')
    expect(await countAssignments(tenantA.id)).toBe(0)
  })

  it('accepts an additions array at exactly the cap', async () => {
    const additions = Array.from({ length: 500 }, (_, i) => ({
      official_id: officialA1.id,
      workstation_id: workstationA.id,
      timeslot_start: T3,
      timeslot_end: T3_END,
      slot_index: i + 1,
    }))

    const { data, error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: additions,
    })

    expect(error).toBeNull()
    expect(data).toHaveLength(500)

    await deleteAllAssignments(tenantA.id)
  })

  // The worst case the cap exists for: one workstation, one timeslot, N
  // additions, none with a slot_index. Every addition probes the occupancy
  // map once per candidate index, so this is the payload that used to cost
  // ~O(N^3) linear array scans inside an open transaction. It has to finish,
  // and it has to number the rows 1..N.
  it('handles a full-cap auto-assign batch on a single timeslot', async () => {
    const addition = {
      official_id: officialA1.id,
      workstation_id: workstationA.id,
      timeslot_start: T3,
      timeslot_end: T3_END,
    }

    const { data, error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: Array.from({ length: 500 }, () => addition),
    })

    expect(error).toBeNull()
    expect(data).toHaveLength(500)
    const slots = (data ?? []).map((r) => r.slot_index).sort((a, b) => a - b)
    expect(slots[0]).toBe(1)
    expect(slots[499]).toBe(500)

    await deleteAllAssignments(tenantA.id)
  })

  it('rejects an over-cap deletions array with ASG04', async () => {
    // Well-formed uuids that match nothing — the cap check runs before the
    // delete, so they never need to exist.
    const deletions = Array.from(
      { length: 5001 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    )

    const { error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: deletions,
      p_status_updates: [],
      p_additions: [],
    })

    expect(error?.code).toBe('ASG04')
  })

  it('rejects an over-cap status_updates array with ASG04', async () => {
    const statusUpdates = Array.from({ length: 501 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      status: 'available',
    }))

    const { error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: statusUpdates,
      p_additions: [],
    })

    expect(error?.code).toBe('ASG04')
  })

  // `p_additions is not null` catches SQL NULL but not a jsonb scalar. Without
  // a jsonb_typeof guard this reached jsonb_array_length() and came back as a
  // raw `cannot get array length of a scalar` — an internal Postgres message
  // returned straight to a client, which the project's conventions forbid.
  it('rejects a jsonb scalar p_additions with ASG03, not a raw Postgres error', async () => {
    const { error } = await clientAdminA.rpc('save_assignments_batch', {
      p_tenant_id: tenantA.id,
      p_deletions: [],
      p_status_updates: [],
      p_additions: 'x' as unknown as [],
    })

    expect(error?.code).toBe('ASG03')
    expect(error?.message).toBe('Invalid assignment payload')
  })
})

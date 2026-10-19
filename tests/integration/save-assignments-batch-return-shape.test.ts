import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  createOfficialLinkedToUser,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

/**
 * save_assignments_batch: the RETURN SHAPE, not the semantics (N12c).
 *
 * perf02-save-assignments-batch.test.ts covers what the RPC writes — rollback,
 * tenant isolation, auto-assigned slot indexes, batch caps. It always asserts
 * against the database afterwards. Nothing asserts what the RPC hands BACK.
 *
 * That gap matters because the return value is not type-checked end to end.
 * actions.ts declares SaveAssignmentsResult.inserted by hand, the arguments
 * cross a jsonb boundary the generated types cannot see into (F-REL-16), and
 * grid-helpers.ts's toLocalAssignments() reads five specific keys off each
 * returned row to build the grid's local state. If the RPC stopped returning
 * one of them — a renamed column in a later migration, a narrowed RETURNS
 * clause — every consumer would read `undefined` with no type error and no
 * runtime error: assignments would render with a missing official or land in
 * the wrong slot, silently. This is the F-REL-10 failure mode (a query that
 * fails quietly and renders empty) one layer further in.
 *
 * So these tests assert the contract itself: the keys, their types, and that
 * the values echo what was asked for.
 */
describe('save_assignments_batch return shape', () => {
  const T1 = new Date('2026-09-02T08:00:00.000Z').toISOString()
  const T1_END = new Date('2026-09-02T09:00:00.000Z').toISOString()
  const T2 = new Date('2026-09-02T10:00:00.000Z').toISOString()
  const T2_END = new Date('2026-09-02T11:00:00.000Z').toISOString()

  // Exactly the columns actions.ts selects and toLocalAssignments() reads.
  const EXPECTED_KEYS = [
    'id',
    'official_id',
    'workstation_id',
    'timeslot_start',
    'slot_index',
  ] as const

  let tenant: { id: string }
  let workstation: { id: string }
  let official1: { id: string }
  let official2: { id: string }
  let client: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenant = await createTenant('Return Shape Tenant')

    const admin = await createUserWithRole(tenant.id, 'tenant_admin')
    client = await signInAsClient(admin.phone, '000000')

    official1 = await createOfficialLinkedToUser(tenant.id, admin.userId, 'Return Shape Admin')

    const second = await createUserWithRole(tenant.id, 'official')
    official2 = await createOfficialLinkedToUser(tenant.id, second.userId, 'Return Shape Official')

    const svc = serviceClient()

    const { data: event, error: eventError } = await svc
      .from('events')
      .insert({ tenant_id: tenant.id, name: 'Return Shape Event', event_type: 'race' })
      .select('id')
      .single()
    if (eventError) throw eventError

    const { data, error } = await svc
      .from('workstations')
      .insert({
        tenant_id: tenant.id,
        event_id: event.id,
        name: 'Return shape WS',
        capacity_ceiling: 4,
      })
      .select('id')
      .single()
    if (error) throw error
    workstation = data
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
  })

  async function save(additions: unknown[], deletions: string[] = []) {
    return client
      .rpc('save_assignments_batch', {
        p_tenant_id: tenant.id,
        p_deletions: deletions,
        p_status_updates: [] as never,
        p_additions: additions as never,
      })
      .select('id, official_id, workstation_id, timeslot_start, slot_index')
  }

  it('returns one row per addition, carrying exactly the contracted keys', async () => {
    const { data, error } = await save([
      {
        official_id: official1.id,
        workstation_id: workstation.id,
        timeslot_start: T1,
        timeslot_end: T1_END,
        slot_index: 1,
      },
      {
        official_id: official2.id,
        workstation_id: workstation.id,
        timeslot_start: T1,
        timeslot_end: T1_END,
        slot_index: 2,
      },
    ])

    expect(error).toBeNull()
    expect(data).toHaveLength(2)

    for (const row of data!) {
      // Every contracted key is present and not null/undefined. A missing key
      // and an explicit null are both failures: toLocalAssignments() would
      // build an assignment the grid cannot place.
      for (const key of EXPECTED_KEYS) {
        expect(Object.keys(row), `row is missing "${key}"`).toContain(key)
        expect(row[key as keyof typeof row], `"${key}" came back empty`).not.toBeNull()
        expect(row[key as keyof typeof row], `"${key}" came back undefined`).toBeDefined()
      }

      expect(typeof row.id).toBe('string')
      expect(typeof row.official_id).toBe('string')
      expect(typeof row.workstation_id).toBe('string')
      expect(typeof row.slot_index).toBe('number')
      // The grid does `new Date(timeslot_start).toISOString()`, so whatever
      // shape it arrives in has to parse.
      expect(Number.isNaN(new Date(row.timeslot_start as string).getTime())).toBe(false)
    }
  })

  it('echoes back the official, workstation and slot that were asked for', async () => {
    const { data, error } = await save([
      {
        official_id: official1.id,
        workstation_id: workstation.id,
        timeslot_start: T2,
        timeslot_end: T2_END,
        slot_index: 3,
      },
    ])

    expect(error).toBeNull()
    expect(data).toHaveLength(1)

    const row = data![0]
    expect(row.official_id).toBe(official1.id)
    expect(row.workstation_id).toBe(workstation.id)
    expect(row.slot_index).toBe(3)
    expect(new Date(row.timeslot_start as string).toISOString()).toBe(T2)

    // The id must be a real row, not a placeholder: the client sends it back
    // as a deletion key, so a fabricated one would make removal a silent no-op.
    const svc = serviceClient()
    const { data: found } = await svc
      .from('assignments')
      .select('id')
      .eq('id', row.id as string)
      .single()
    expect(found?.id).toBe(row.id)
  })

  it('reports the auto-assigned slot_index rather than the null that was sent', async () => {
    // The caller may omit slot_index and let the RPC pick. The returned row is
    // the ONLY way the client learns which index it got — the grid places the
    // cell by it, so a null here would stack the assignment on an unknown row.
    const T3 = new Date('2026-09-02T12:00:00.000Z').toISOString()
    const T3_END = new Date('2026-09-02T13:00:00.000Z').toISOString()

    const { data, error } = await save([
      {
        official_id: official1.id,
        workstation_id: workstation.id,
        timeslot_start: T3,
        timeslot_end: T3_END,
        slot_index: null,
      },
    ])

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].slot_index).not.toBeNull()
    expect(typeof data![0].slot_index).toBe('number')
  })

  it('returns an empty array, not null, for a batch that only deletes', async () => {
    // actions.ts does `return { inserted: data ?? [] }`, and the hook spreads
    // the result into local state. A null here is survivable; a non-array
    // would throw inside the spread. Pin the shape.
    const T4 = new Date('2026-09-02T14:00:00.000Z').toISOString()
    const T4_END = new Date('2026-09-02T15:00:00.000Z').toISOString()

    const { data: inserted } = await save([
      {
        official_id: official1.id,
        workstation_id: workstation.id,
        timeslot_start: T4,
        timeslot_end: T4_END,
        slot_index: 1,
      },
    ])
    const id = inserted![0].id as string

    const { data, error } = await save([], [id])

    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })
})

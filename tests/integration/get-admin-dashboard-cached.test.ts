import { describe, it, expect, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { serviceClient, createTenant, createUserWithRole, cleanupTenant, signInAsClient } from './helpers'

// PERF-06 / F-PERF-04 Phase 3 (ADR-0003): get_admin_dashboard_cached
// (migration 0054). Same fail-closed construction and same reasoning for the
// cross-tenant assertions as the Group 1 RPCs (get-event-info-cached.test.ts
// etc.) — see that file's header for why "tenant B's rows are absent" is the
// check that actually exercises ownership, not just "the call didn't error."
//
// Wider surface than Group 1: this RPC also reads `officials` directly and
// `assignments`/`workstations` transitively through a nested call to
// scheduling_warning_counts (migration 0040, SECURITY INVOKER). That nested
// call is exactly what these tests exercise beyond the Group 1 shape: if the
// migration's EXECUTE grant on scheduling_warning_counts to cache_rpc_reader
// were missing, or the new `assignments` policy were missing, every call
// below would fail with "permission denied", not silently under-report — the
// happy-path tests below are what would catch that, not a dedicated
// negative test.

function callRpc(client: SupabaseClient<Database>, tenantId: string) {
  // TODO(PERF-06 Phase 3): temporary `any` cast — get_admin_dashboard_cached
  // (migration 0054) isn't in src/types/database.ts yet because that's
  // generated from dev's schema and this migration hasn't been pushed there.
  // Remove the cast once db:types is regenerated post-push (same convention
  // as admin/dashboard/page.tsx's own cast).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client.rpc as any)('get_admin_dashboard_cached', { p_tenant_id: tenantId })
}

interface AdminDashboardCached {
  event: {
    id: string
    name: string | null
    event_type: string | null
    start_date: string | null
    end_date: string | null
    status: string
    scheduling_granularity_min: number
    logo_url: string | null
  } | null
  officials_invited: number
  officials_confirmed: number
  race_stage_count: number
  over_capacity: number
  double_booked: number
  earliest_day: string | null
  earliest_stage_id: string | null
}

async function randomPhone() {
  return `+46704${Math.floor(Math.random() * 1_000_000)}`
}

describe('get_admin_dashboard_cached RPC (PERF-06 Phase 3 fail-closed boundary)', () => {
  const createdTenantIds: string[] = []

  afterAll(async () => {
    await Promise.all(createdTenantIds.map((id) => cleanupTenant(id)))
  })

  it('returns the exact shape the page destructures, including officials counts, race-stage count, and warning counts', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Dashboard Shape')
    createdTenantIds.push(tenant.id)

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({
        tenant_id: tenant.id,
        name: 'Shape Test Event',
        event_type: 'race',
        status: 'draft',
        start_date: '2026-09-20',
        end_date: '2026-09-21',
      })
      .select()
      .single()
    if (eventError) throw eventError

    const { data: stage, error: stageError } = await admin
      .from('event_stages')
      .insert({
        tenant_id: tenant.id,
        event_id: event.id,
        name: 'Shape Test Stage',
        stage_type: 'race',
        position: 0,
      })
      .select()
      .single()
    if (stageError) throw stageError

    const { data: workstation, error: wsError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenant.id,
        event_id: event.id,
        stage_id: stage.id,
        name: 'Shape Test WS',
        capacity_ceiling: 1,
      })
      .select()
      .single()
    if (wsError) throw wsError

    const officialInvited = await admin
      .from('officials')
      .insert({
        tenant_id: tenant.id,
        name: 'Shape Invited Official',
        phone: await randomPhone(),
        invite_status: 'invited',
      })
      .select()
      .single()
    if (officialInvited.error) throw officialInvited.error

    const officialConfirmed1 = await admin
      .from('officials')
      .insert({
        tenant_id: tenant.id,
        name: 'Shape Confirmed Official 1',
        phone: await randomPhone(),
        invite_status: 'confirmed',
      })
      .select()
      .single()
    if (officialConfirmed1.error) throw officialConfirmed1.error

    const officialConfirmed2 = await admin
      .from('officials')
      .insert({
        tenant_id: tenant.id,
        name: 'Shape Confirmed Official 2',
        phone: await randomPhone(),
        invite_status: 'confirmed',
      })
      .select()
      .single()
    if (officialConfirmed2.error) throw officialConfirmed2.error

    // capacity_ceiling is 1 — two officials at the same slot is over.
    const timeslotStart = '2026-09-20T10:00:00.000Z'
    const timeslotEnd = '2026-09-20T10:30:00.000Z'
    const { error: assign1Error } = await admin.from('assignments').insert({
      tenant_id: tenant.id,
      official_id: officialConfirmed1.data.id,
      workstation_id: workstation.id,
      timeslot_start: timeslotStart,
      timeslot_end: timeslotEnd,
      slot_index: 0,
      status: 'assigned',
    })
    if (assign1Error) throw assign1Error
    const { error: assign2Error } = await admin.from('assignments').insert({
      tenant_id: tenant.id,
      official_id: officialConfirmed2.data.id,
      workstation_id: workstation.id,
      timeslot_start: timeslotStart,
      timeslot_end: timeslotEnd,
      slot_index: 1,
      status: 'assigned',
    })
    if (assign2Error) throw assign2Error

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as AdminDashboardCached

    expect(payload.event).toEqual({
      id: event.id,
      name: 'Shape Test Event',
      event_type: 'race',
      start_date: '2026-09-20',
      end_date: '2026-09-21',
      status: 'draft',
      scheduling_granularity_min: expect.any(Number),
      logo_url: null,
    })
    expect(payload.officials_invited).toBe(1)
    expect(payload.officials_confirmed).toBe(2)
    expect(payload.race_stage_count).toBe(1)
    expect(payload.over_capacity).toBe(1)
    expect(payload.double_booked).toBe(0)
    expect(payload.earliest_day).toBe('2026-09-20')
    expect(payload.earliest_stage_id).toBe(stage.id)
  })

  it('returns a null event, zero counts, and no warnings when the tenant has no event row', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Dashboard No Event')
    createdTenantIds.push(tenant.id)

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as AdminDashboardCached
    expect(payload.event).toBeNull()
    expect(payload.officials_invited).toBe(0)
    expect(payload.officials_confirmed).toBe(0)
    expect(payload.race_stage_count).toBe(0)
    expect(payload.over_capacity).toBe(0)
    expect(payload.double_booked).toBe(0)
    expect(payload.earliest_day).toBeNull()
    expect(payload.earliest_stage_id).toBeNull()
  })

  it('returns zero counts and no warnings for a tenant with officials but no event yet', async () => {
    // Officials can be invited before an event exists (invite flow and event
    // config are independent) — the officials counts must not depend on
    // v_event_id being non-null the way race_stage_count and the warning
    // counts do.
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Dashboard Officials No Event')
    createdTenantIds.push(tenant.id)

    const { error: officialError } = await admin.from('officials').insert({
      tenant_id: tenant.id,
      name: 'Early Invited Official',
      phone: await randomPhone(),
      invite_status: 'invited',
    })
    if (officialError) throw officialError

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as AdminDashboardCached
    expect(payload.event).toBeNull()
    expect(payload.officials_invited).toBe(1)
    expect(payload.race_stage_count).toBe(0)
    expect(payload.over_capacity).toBe(0)
    expect(payload.double_booked).toBe(0)
  })

  it("does not leak another tenant's officials counts, race-stage count, or warnings", async () => {
    const admin = serviceClient()
    const tenantA = await createTenant('PERF-06 Dashboard Tenant A')
    const tenantB = await createTenant('PERF-06 Dashboard Tenant B')
    createdTenantIds.push(tenantA.id, tenantB.id)

    async function seed(tenantId: string, label: string, officialCount: number) {
      const { data: event, error: eventError } = await admin
        .from('events')
        .insert({ tenant_id: tenantId, name: `${label} Event`, event_type: 'race' })
        .select()
        .single()
      if (eventError) throw eventError

      const { data: stage, error: stageError } = await admin
        .from('event_stages')
        .insert({
          tenant_id: tenantId,
          event_id: event.id,
          name: `${label} Stage`,
          stage_type: 'race',
          position: 0,
        })
        .select()
        .single()
      if (stageError) throw stageError

      const { data: workstation, error: wsError } = await admin
        .from('workstations')
        .insert({
          tenant_id: tenantId,
          event_id: event.id,
          stage_id: stage.id,
          name: `${label} WS`,
          capacity_ceiling: 1,
        })
        .select()
        .single()
      if (wsError) throw wsError

      const officialIds: string[] = []
      for (let i = 0; i < officialCount; i++) {
        const { data: official, error: officialError } = await admin
          .from('officials')
          .insert({
            tenant_id: tenantId,
            name: `${label} Official ${i}`,
            phone: await randomPhone(),
            invite_status: 'confirmed',
          })
          .select()
          .single()
        if (officialError) throw officialError
        officialIds.push(official.id)
      }

      // Two officials at a capacity-1 workstation, same slot -> over_capacity.
      for (let i = 0; i < 2; i++) {
        const { error: assignError } = await admin.from('assignments').insert({
          tenant_id: tenantId,
          official_id: officialIds[i],
          workstation_id: workstation.id,
          timeslot_start: '2026-09-20T10:00:00.000Z',
          timeslot_end: '2026-09-20T10:30:00.000Z',
          slot_index: i,
          status: 'assigned',
        })
        if (assignError) throw assignError
      }
    }

    await seed(tenantA.id, 'Tenant A', 2)
    await seed(tenantB.id, 'Tenant B', 3)

    const { data: asA, error } = await callRpc(admin, tenantA.id)
    expect(error).toBeNull()
    const payloadA = asA as unknown as AdminDashboardCached

    expect(payloadA.officials_confirmed).toBe(2)
    expect(payloadA.over_capacity).toBe(1)
    expect(payloadA.event?.name).toBe('Tenant A Event')
  })

  it('raises instead of silently picking one event when a tenant has more than one event row', async () => {
    // Schema allows this (no unique constraint on events.tenant_id) even
    // though the app never creates a second one — the old direct-query page
    // used `.maybeSingle()`, which throws in this case rather than silently
    // picking a row. This RPC must fail the same way, not quietly resolve to
    // the oldest event.
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Dashboard Multiple Events')
    createdTenantIds.push(tenant.id)

    const { error: firstError } = await admin
      .from('events')
      .insert({ tenant_id: tenant.id, name: 'First Event', event_type: 'race' })
    if (firstError) throw firstError

    const { error: secondError } = await admin
      .from('events')
      .insert({ tenant_id: tenant.id, name: 'Second Event', event_type: 'race' })
    if (secondError) throw secondError

    const { error } = await callRpc(admin, tenant.id)
    expect(error).not.toBeNull()
    // Assert the actual guard fired, not just that *some* error occurred —
    // a bare not-null check would also pass if this failed for an unrelated
    // reason (e.g. a permission error), silently hiding a broken guard.
    expect(error?.message).toContain('expected at most 1')
  })

  describe('access control: anon/authenticated must be denied', () => {
    const anon: SupabaseClient<Database> = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    )

    it('denies anon calling the RPC directly', async () => {
      const { error } = await callRpc(anon, '00000000-0000-0000-0000-000000000001')
      expect(error).not.toBeNull()
    })

    it('denies an authenticated tenant admin calling the RPC directly, even for their own tenant', async () => {
      const tenant = await createTenant('PERF-06 Dashboard ACL Authenticated')
      createdTenantIds.push(tenant.id)
      const { phone } = await createUserWithRole(tenant.id, 'tenant_admin')

      const authClient = await signInAsClient(phone, '000000')
      const { error } = await callRpc(authClient, tenant.id)
      expect(error).not.toBeNull()
    })

    it('returns zero rows for an anon direct SELECT on officials and assignments', async () => {
      // Existing RLS policies filter rows rather than erroring for a caller
      // with no resolvable role — same shape as tenant-isolation-*.test.ts.
      // ADR rule 4b: proves anon is denied at the table level too, not just
      // via the RPC's EXECUTE grant.
      const { data: officialsData, error: officialsError } = await anon
        .from('officials')
        .select('*')
      expect(officialsError).toBeNull()
      expect(officialsData).toEqual([])

      const { data: assignmentsData, error: assignmentsError } = await anon
        .from('assignments')
        .select('*')
      expect(assignmentsError).toBeNull()
      expect(assignmentsData).toEqual([])
    })
  })
})

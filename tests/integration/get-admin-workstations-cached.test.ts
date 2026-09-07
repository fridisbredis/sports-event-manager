import { describe, it, expect, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { serviceClient, createTenant, createUserWithRole, cleanupTenant, signInAsClient } from './helpers'

// PERF-06 / F-PERF-04 Phase 2 (ADR-0003): get_admin_workstations_cached
// (migration 0053), last of the three Group 1 tenant-only caching RPCs. Same
// construction and same reasoning for the cross-tenant assertions as
// get-event-info-cached.test.ts — see that file's header.
//
// Two things unique to this RPC get their own coverage below, per the
// migration's own header comments:
// - `workstation_operating_windows` has no tenant_id column of its own; its
//   RLS policy is an EXISTS subquery through `workstations`, not a direct
//   GUC compare like every other Group 1 table. The cross-tenant test here
//   creates windows for both tenants' workstations so a broken EXISTS
//   predicate (e.g. one that forgot the tenant compare and only checked
//   `w.id = workstation_id`) would leak tenant B's windows into tenant A's
//   result.
// - The nested `workstation_operating_windows` key and its `window_start` /
//   `window_end` element keys are a contract with
//   `_components/workstations-list.tsx` (its `OperatingWindow` type and its
//   `?? []` read) — asserted here key-by-key, not just "the call succeeded."

function callRpc(client: SupabaseClient<Database>, tenantId: string) {
  // TODO(PERF-06 Phase 2): temporary `any` cast — get_admin_workstations_cached
  // (migration 0053) isn't in src/types/database.ts yet because that's
  // generated from dev's schema and this migration hasn't been pushed there.
  // Remove the cast once db:types is regenerated post-push (same convention
  // as admin/workstations/page.tsx's own cast).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client.rpc as any)('get_admin_workstations_cached', { p_tenant_id: tenantId })
}

interface AdminWorkstationsCached {
  event: { id: string } | null
  stages: Array<{
    id: string
    name: string
    stage_type: string
    start_time: string | null
    end_time: string | null
  }>
  workstations: Array<{
    id: string
    name: string
    capacity_ceiling: number
    stage_id: string | null
    workstation_operating_windows: Array<{ window_start: string; window_end: string }>
  }>
}

async function seedTenantEventAndWorkstation(
  admin: ReturnType<typeof serviceClient>,
  tenantId: string,
  label: string,
  windows: Array<{ window_start: string; window_end: string }>
) {
  const { data: event, error: eventError } = await admin
    .from('events')
    .insert({ tenant_id: tenantId, name: `${label} Event`, event_type: 'race' })
    .select()
    .single()
  if (eventError) throw eventError

  const { data: stage, error: stageError } = await admin
    .from('event_stages')
    .insert({ tenant_id: tenantId, event_id: event.id, name: `${label} Stage`, position: 0 })
    .select()
    .single()
  if (stageError) throw stageError

  const { data: workstation, error: wsError } = await admin
    .from('workstations')
    .insert({
      tenant_id: tenantId,
      event_id: event.id,
      stage_id: stage.id,
      name: `${label} Workstation`,
      capacity_ceiling: 4,
    })
    .select()
    .single()
  if (wsError) throw wsError

  if (windows.length > 0) {
    const { error: winError } = await admin
      .from('workstation_operating_windows')
      .insert(windows.map((w) => ({ workstation_id: workstation.id, ...w })))
    if (winError) throw winError
  }

  return { event, stage, workstation }
}

describe('get_admin_workstations_cached RPC (PERF-06 Phase 2 fail-closed boundary)', () => {
  const createdTenantIds: string[] = []

  afterAll(async () => {
    await Promise.all(createdTenantIds.map((id) => cleanupTenant(id)))
  })

  it('returns the exact event/stages/workstations shape the page destructures, including nested windows', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Admin WS Shape')
    createdTenantIds.push(tenant.id)
    const { event, stage, workstation } = await seedTenantEventAndWorkstation(
      admin,
      tenant.id,
      'Shape Test',
      [{ window_start: '2026-09-01T08:00:00Z', window_end: '2026-09-01T16:00:00Z' }]
    )

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as AdminWorkstationsCached

    expect(payload.event).toEqual({ id: event.id })
    expect(payload.stages).toEqual([
      {
        id: stage.id,
        name: 'Shape Test Stage',
        stage_type: 'race',
        start_time: null,
        end_time: null,
      },
    ])
    expect(payload.workstations).toHaveLength(1)
    expect(payload.workstations[0]).toEqual({
      id: workstation.id,
      name: 'Shape Test Workstation',
      capacity_ceiling: 4,
      stage_id: stage.id,
      workstation_operating_windows: [
        { window_start: expect.any(String), window_end: expect.any(String) },
      ],
    })
  })

  it('returns an empty windows array for a workstation with none, rather than dropping it', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Admin WS No Windows')
    createdTenantIds.push(tenant.id)
    await seedTenantEventAndWorkstation(admin, tenant.id, 'No Windows', [])

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as AdminWorkstationsCached
    expect(payload.workstations).toHaveLength(1)
    expect(payload.workstations[0].workstation_operating_windows).toEqual([])
  })

  it('returns a null event, empty stages, and empty workstations when the tenant has no event row', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Admin WS No Event')
    createdTenantIds.push(tenant.id)

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as AdminWorkstationsCached
    expect(payload.event).toBeNull()
    expect(payload.stages).toEqual([])
    expect(payload.workstations).toEqual([])
  })

  it(
    'does not leak another tenant\'s stages, workstations, or operating windows — ' +
      'including through the EXISTS-subquery policy on workstation_operating_windows',
    async () => {
      const admin = serviceClient()
      const tenantA = await createTenant('PERF-06 Admin WS Tenant A')
      const tenantB = await createTenant('PERF-06 Admin WS Tenant B')
      createdTenantIds.push(tenantA.id, tenantB.id)

      await seedTenantEventAndWorkstation(admin, tenantA.id, 'Tenant A', [
        { window_start: '2026-09-01T08:00:00Z', window_end: '2026-09-01T10:00:00Z' },
      ])
      await seedTenantEventAndWorkstation(admin, tenantB.id, 'Tenant B', [
        { window_start: '2026-09-02T08:00:00Z', window_end: '2026-09-02T10:00:00Z' },
      ])

      const { data: asA, error } = await callRpc(admin, tenantA.id)
      expect(error).toBeNull()
      const payloadA = asA as unknown as AdminWorkstationsCached

      expect(payloadA.stages.every((s) => s.name.startsWith('Tenant A'))).toBe(true)
      expect(payloadA.workstations).toHaveLength(1)
      expect(payloadA.workstations[0].name).toBe('Tenant A Workstation')
      expect(payloadA.workstations[0].workstation_operating_windows).toHaveLength(1)

      expect(payloadA.stages.some((s) => s.name.startsWith('Tenant B'))).toBe(false)
      expect(payloadA.workstations.some((w) => w.name.startsWith('Tenant B'))).toBe(false)
    }
  )

  it('deterministically orders nested windows by window_start', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Admin WS Window Order')
    createdTenantIds.push(tenant.id)
    await seedTenantEventAndWorkstation(admin, tenant.id, 'Window Order', [
      { window_start: '2026-09-01T14:00:00Z', window_end: '2026-09-01T16:00:00Z' },
      { window_start: '2026-09-01T08:00:00Z', window_end: '2026-09-01T10:00:00Z' },
    ])

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as AdminWorkstationsCached
    const windows = payload.workstations[0].workstation_operating_windows
    expect(windows).toHaveLength(2)
    expect(new Date(windows[0].window_start).getTime()).toBeLessThan(
      new Date(windows[1].window_start).getTime()
    )
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
      const tenant = await createTenant('PERF-06 Admin WS ACL Authenticated')
      createdTenantIds.push(tenant.id)
      const { phone } = await createUserWithRole(tenant.id, 'tenant_admin')

      const authClient = await signInAsClient(phone, '000000')
      const { error } = await callRpc(authClient, tenant.id)
      expect(error).not.toBeNull()
    })

    it('returns zero rows for an anon direct SELECT on workstations and workstation_operating_windows', async () => {
      // Existing RLS policies filter rows rather than erroring for a caller
      // with no resolvable role — same shape as
      // tenant-isolation-events.test.ts. ADR rule 4b: proves anon is denied
      // at the table level too, not just via the RPC's EXECUTE grant.
      const { data: wsData, error: wsError } = await anon.from('workstations').select('*')
      expect(wsError).toBeNull()
      expect(wsData).toEqual([])
      const { data: winData, error: winError } = await anon
        .from('workstation_operating_windows')
        .select('*')
      expect(winError).toBeNull()
      expect(winData).toEqual([])
    })
  })
})

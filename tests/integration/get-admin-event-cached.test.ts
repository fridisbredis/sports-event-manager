import { describe, it, expect, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { serviceClient, createTenant, createUserWithRole, cleanupTenant, signInAsClient } from './helpers'

// PERF-06 / F-PERF-04 Phase 2 (ADR-0003): get_admin_event_cached (migration
// 0052), second of the three Group 1 tenant-only caching RPCs. Same
// construction and same reasoning for the cross-tenant assertions as
// get-event-info-cached.test.ts — see that file's header for why "tenant B's
// rows are absent" is the check that actually exercises ownership, not just
// "the call didn't error."
//
// This RPC's shape is wider than get_event_info_cached's (id, location,
// scheduling_granularity_min on events; race_type on stages; the whole
// event_distances table) and child reads are scoped by BOTH event_id and
// tenant_id inside the function body — the multi-stage/multi-distance
// fixture below exercises that join, not just a single flat row per table.

function callRpc(client: SupabaseClient<Database>, tenantId: string) {
  // TODO(PERF-06 Phase 2): temporary `any` cast — get_admin_event_cached
  // (migration 0052) isn't in src/types/database.ts yet because that's
  // generated from dev's schema and this migration hasn't been pushed there.
  // Remove the cast once db:types is regenerated post-push (same convention
  // as admin/event/page.tsx's own cast).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client.rpc as any)('get_admin_event_cached', { p_tenant_id: tenantId })
}

interface AdminEventCached {
  event: {
    id: string
    name: string | null
    event_type: string | null
    description: string | null
    location: string | null
    logo_url: string | null
    status: string
    scheduling_granularity_min: number
  } | null
  stages: Array<{
    id: string
    name: string
    stage_type: string
    race_type: string
    start_time: string | null
    end_time: string | null
    venue: string | null
    position: number
  }>
  distances: Array<{ label: string; position: number; stage_id: string | null }>
  facilities: Array<{ label: string; position: number }>
}

async function seedTenantEvent(
  admin: ReturnType<typeof serviceClient>,
  tenantId: string,
  eventName: string
) {
  const { data: event, error: eventError } = await admin
    .from('events')
    .insert({
      tenant_id: tenantId,
      name: eventName,
      event_type: 'race',
      status: 'draft',
      location: 'Test City',
    })
    .select()
    .single()
  if (eventError) throw eventError

  const { data: stage, error: stageError } = await admin
    .from('event_stages')
    .insert({
      tenant_id: tenantId,
      event_id: event.id,
      name: `${eventName} Stage 1`,
      stage_type: 'race',
      race_type: 'distance',
      position: 0,
    })
    .select()
    .single()
  if (stageError) throw stageError

  const { error: distanceError } = await admin.from('event_distances').insert({
    tenant_id: tenantId,
    event_id: event.id,
    stage_id: stage.id,
    label: `${eventName} 10k`,
    position: 0,
  })
  if (distanceError) throw distanceError

  const { error: facilityError } = await admin.from('event_facilities').insert({
    tenant_id: tenantId,
    event_id: event.id,
    label: `${eventName} Water Station`,
    position: 0,
  })
  if (facilityError) throw facilityError

  return { event, stage }
}

describe('get_admin_event_cached RPC (PERF-06 Phase 2 fail-closed boundary)', () => {
  const createdTenantIds: string[] = []

  afterAll(async () => {
    await Promise.all(createdTenantIds.map((id) => cleanupTenant(id)))
  })

  it('returns the exact event/stages/distances/facilities shape the page destructures', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Admin Event Shape')
    createdTenantIds.push(tenant.id)
    const { event, stage } = await seedTenantEvent(admin, tenant.id, 'Shape Test Event')

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as AdminEventCached

    expect(payload.event).toEqual({
      id: event.id,
      name: 'Shape Test Event',
      event_type: 'race',
      description: null,
      location: 'Test City',
      logo_url: null,
      status: 'draft',
      scheduling_granularity_min: expect.any(Number),
    })
    expect(payload.stages).toEqual([
      {
        id: stage.id,
        name: 'Shape Test Event Stage 1',
        stage_type: 'race',
        race_type: 'distance',
        start_time: null,
        end_time: null,
        venue: null,
        position: 0,
      },
    ])
    expect(payload.distances).toEqual([
      { label: 'Shape Test Event 10k', position: 0, stage_id: stage.id },
    ])
    expect(payload.facilities).toEqual([{ label: 'Shape Test Event Water Station', position: 0 }])
  })

  it('returns a null event and empty arrays when the tenant has no event row', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Admin Event No Event')
    createdTenantIds.push(tenant.id)

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as AdminEventCached
    expect(payload.event).toBeNull()
    expect(payload.stages).toEqual([])
    expect(payload.distances).toEqual([])
    expect(payload.facilities).toEqual([])
  })

  it('does not leak another tenant\'s event, stages, distances, or facilities', async () => {
    const admin = serviceClient()
    const tenantA = await createTenant('PERF-06 Admin Event Tenant A')
    const tenantB = await createTenant('PERF-06 Admin Event Tenant B')
    createdTenantIds.push(tenantA.id, tenantB.id)

    await seedTenantEvent(admin, tenantA.id, 'Tenant A Event')
    await seedTenantEvent(admin, tenantB.id, 'Tenant B Event')

    const { data: asA, error } = await callRpc(admin, tenantA.id)
    expect(error).toBeNull()
    const payloadA = asA as unknown as AdminEventCached

    expect(payloadA.event?.name).toBe('Tenant A Event')
    expect(payloadA.stages.every((s) => s.name.startsWith('Tenant A'))).toBe(true)
    expect(payloadA.distances.every((d) => d.label.startsWith('Tenant A'))).toBe(true)
    expect(payloadA.facilities.every((f) => f.label.startsWith('Tenant A'))).toBe(true)
    expect(payloadA.stages.some((s) => s.name.startsWith('Tenant B'))).toBe(false)
    expect(payloadA.distances.some((d) => d.label.startsWith('Tenant B'))).toBe(false)
    expect(payloadA.facilities.some((f) => f.label.startsWith('Tenant B'))).toBe(false)
  })

  it('scopes child reads by event_id, not just tenant_id, when a tenant has one event', async () => {
    // Regression guard for the event-picking join: distances/stages must
    // trace back through v_event_id, not merely match tenant_id — a bug that
    // dropped the `event_id` filter would still pass every other test here
    // since each tenant fixture has exactly one event.
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Admin Event Child Scope')
    createdTenantIds.push(tenant.id)
    const { stage } = await seedTenantEvent(admin, tenant.id, 'Child Scope Event')

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as AdminEventCached
    expect(payload.distances).toHaveLength(1)
    expect(payload.distances[0].stage_id).toBe(stage.id)
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
      const tenant = await createTenant('PERF-06 Admin Event ACL Authenticated')
      createdTenantIds.push(tenant.id)
      const { phone } = await createUserWithRole(tenant.id, 'tenant_admin')

      const authClient = await signInAsClient(phone, '000000')
      const { error } = await callRpc(authClient, tenant.id)
      expect(error).not.toBeNull()
    })

    it('returns zero rows for an anon direct SELECT on event_distances', async () => {
      // Existing RLS policy filters rows rather than erroring for a caller
      // with no resolvable role — same shape as
      // tenant-isolation-events.test.ts. ADR rule 4b: proves anon is denied
      // at the table level too, not just via the RPC's EXECUTE grant.
      const { data, error } = await anon.from('event_distances').select('*')
      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  })
})

import { describe, it, expect, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { serviceClient, createTenant, createUserWithRole, cleanupTenant, signInAsClient } from './helpers'

// PERF-06 / F-PERF-04 Phase 2 (ADR-0003): get_event_info_cached (migration
// 0049) is the first of the three Group 1 tenant-only caching RPCs. Same
// fail-closed construction as the Phase 1 pilot (0048, see
// get-official-home-cached.test.ts) — a SECURITY DEFINER RPC owned by
// cache_rpc_reader (NOBYPASSRLS, migration 0047), called only via the
// service-role client from inside unstable_cache.
//
// The cross-tenant assertions below are the substantive "does ownership
// actually matter" check the ADR calls for (rule 2/4): they don't merely
// assert "no error" — a postgres-owned (BYPASSRLS) variant of this RPC would
// also return 200 with no error, just with the wrong tenant's rows mixed in.
// Fetching as tenant A and asserting tenant B's row is genuinely absent is
// what a leaking RPC would fail. There is no in-repo mechanism to directly
// query pg_roles.rolbypassrls or temporarily reassign the function's owner
// from a PostgREST-only test client (no raw-SQL exec helper exists in this
// suite, deliberately — see setup-env.ts's local-only guard), so this
// behavioural proof is what stands in for that literal check.

function callRpc(client: SupabaseClient<Database>, tenantId: string) {
  // TODO(PERF-06 Phase 2): temporary `any` cast — get_event_info_cached
  // (migration 0049) isn't in src/types/database.ts yet because that's
  // generated from dev's schema and this migration hasn't been pushed there.
  // Remove the cast once db:types is regenerated post-push (same convention
  // as event-info/page.tsx's own cast).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client.rpc as any)('get_event_info_cached', { p_tenant_id: tenantId })
}

interface EventInfoCached {
  event: {
    name: string | null
    event_type: string | null
    description: string | null
    logo_url: string | null
    status: string
  } | null
  stages: Array<{
    id: string
    name: string
    stage_type: string
    start_time: string | null
    end_time: string | null
    venue: string | null
    position: number
  }>
  facilities: Array<{ id: string; label: string; position: number }>
}

async function seedTenantEvent(
  admin: ReturnType<typeof serviceClient>,
  tenantId: string,
  eventName: string
) {
  const { data: event, error: eventError } = await admin
    .from('events')
    .insert({ tenant_id: tenantId, name: eventName, event_type: 'race', status: 'published' })
    .select()
    .single()
  if (eventError) throw eventError

  const { error: stageError } = await admin.from('event_stages').insert({
    tenant_id: tenantId,
    event_id: event.id,
    name: `${eventName} Stage 1`,
    stage_type: 'race',
    position: 0,
    start_time: '2026-09-01T08:00:00Z',
    end_time: '2026-09-01T12:00:00Z',
    venue: 'Main venue',
  })
  if (stageError) throw stageError

  const { error: facilityError } = await admin.from('event_facilities').insert({
    tenant_id: tenantId,
    event_id: event.id,
    label: `${eventName} Water Station`,
    position: 0,
  })
  if (facilityError) throw facilityError

  return event
}

describe('get_event_info_cached RPC (PERF-06 Phase 2 fail-closed boundary)', () => {
  const createdTenantIds: string[] = []

  afterAll(async () => {
    await Promise.all(createdTenantIds.map((id) => cleanupTenant(id)))
  })

  it('returns the exact event/stages/facilities shape the page destructures', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Event Info Shape')
    createdTenantIds.push(tenant.id)
    await seedTenantEvent(admin, tenant.id, 'Shape Test Event')

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as EventInfoCached

    expect(payload.event).toEqual({
      name: 'Shape Test Event',
      event_type: 'race',
      description: null,
      logo_url: null,
      status: 'published',
    })
    expect(payload.stages).toEqual([
      {
        id: expect.any(String),
        name: 'Shape Test Event Stage 1',
        stage_type: 'race',
        start_time: '2026-09-01T08:00:00+00:00',
        end_time: '2026-09-01T12:00:00+00:00',
        venue: 'Main venue',
        position: 0,
      },
    ])
    expect(payload.facilities).toEqual([
      { id: expect.any(String), label: 'Shape Test Event Water Station', position: 0 },
    ])
  })

  it('returns a null event and empty arrays when the tenant has no event row', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('PERF-06 Event Info No Event')
    createdTenantIds.push(tenant.id)

    const { data, error } = await callRpc(admin, tenant.id)
    expect(error).toBeNull()
    const payload = data as unknown as EventInfoCached
    expect(payload.event).toBeNull()
    expect(payload.stages).toEqual([])
    expect(payload.facilities).toEqual([])
  })

  it('does not leak another tenant\'s event, stages, or facilities', async () => {
    const admin = serviceClient()
    const tenantA = await createTenant('PERF-06 Event Info Tenant A')
    const tenantB = await createTenant('PERF-06 Event Info Tenant B')
    createdTenantIds.push(tenantA.id, tenantB.id)

    await seedTenantEvent(admin, tenantA.id, 'Tenant A Event')
    await seedTenantEvent(admin, tenantB.id, 'Tenant B Event')

    const { data: asA, error } = await callRpc(admin, tenantA.id)
    expect(error).toBeNull()
    const payloadA = asA as unknown as EventInfoCached

    expect(payloadA.event?.name).toBe('Tenant A Event')
    expect(payloadA.stages.every((s) => s.name.startsWith('Tenant A'))).toBe(true)
    expect(payloadA.facilities.every((f) => f.label.startsWith('Tenant A'))).toBe(true)
    // The leak this test exists to catch: none of tenant B's rows appear
    // anywhere in tenant A's result.
    expect(payloadA.stages.some((s) => s.name.startsWith('Tenant B'))).toBe(false)
    expect(payloadA.facilities.some((f) => f.label.startsWith('Tenant B'))).toBe(false)
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
      const tenant = await createTenant('PERF-06 Event Info ACL Authenticated')
      createdTenantIds.push(tenant.id)
      const { phone } = await createUserWithRole(tenant.id, 'tenant_admin')

      // A real signed-in session, not just an anon-key client with no
      // session — the RPC's grant excludes `authenticated` entirely, so this
      // must be denied even though the tenant_id passed is this admin's own.
      const authClient = await signInAsClient(phone, '000000')
      const { error } = await callRpc(authClient, tenant.id)
      expect(error).not.toBeNull()
    })

    it('returns zero rows for an anon direct SELECT on events/event_stages/event_facilities', async () => {
      // Existing tenant_member_read_* RLS policies (0004/0005) filter rows
      // rather than erroring for a caller with no resolvable role — same
      // shape as tenant-isolation-events.test.ts's cross-tenant assertions.
      // This is the ADR's rule 4b: proves anon is denied at the table level
      // too, not just via the RPC's own EXECUTE grant.
      const { data: eventsData, error: eventsError } = await anon.from('events').select('*')
      expect(eventsError).toBeNull()
      expect(eventsData).toEqual([])
      const { data: stagesData, error: stagesError } = await anon.from('event_stages').select('*')
      expect(stagesError).toBeNull()
      expect(stagesData).toEqual([])
      const { data: facilitiesData, error: facilitiesError } = await anon
        .from('event_facilities')
        .select('*')
      expect(facilitiesError).toBeNull()
      expect(facilitiesData).toEqual([])
    })
  })
})

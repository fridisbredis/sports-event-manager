import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { serviceClient, createSystemAdmin, deleteAuthUser, signInAsClient } from './helpers'

// REL-01: createTenant() in src/app/(system)/admin/actions.ts performs three
// separate .insert() calls (tenants, events, event_stages) with no
// surrounding transaction. If the third insert fails, the first two are left
// behind — an orphaned tenant with no default event/stages, invisible to any
// unit test that mocks the Supabase client per call.
//
// This test reproduces that exact sequence directly against Postgres (not
// through the server action, which requires Next.js request context) to
// prove the gap, then — once `create_tenant_with_defaults` exists — exercises
// the RPC to prove the fix. Today only the first `it` can pass; the second is
// the red test this migration is written to turn green.
describe('createTenant: atomicity across tenants/events/event_stages', () => {
  const createdTenantIds: string[] = []
  let systemAdmin: Awaited<ReturnType<typeof createSystemAdmin>>
  let clientSystemAdmin: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    systemAdmin = await createSystemAdmin()
    clientSystemAdmin = await signInAsClient(systemAdmin.phone, '000000')
  })

  afterAll(async () => {
    await deleteAuthUser(systemAdmin.userId)
  })

  afterEach(async () => {
    const admin = serviceClient()
    await Promise.all(createdTenantIds.map((id) => admin.from('tenants').delete().eq('id', id)))
    createdTenantIds.length = 0
  })

  it("documents the bug: today's uncoordinated inserts leave an orphaned tenant when the third insert fails", async () => {
    const admin = serviceClient()
    const slug = `atomicity-bug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const { data: tenant, error: tenantError } = await admin
      .from('tenants')
      .insert({ name: 'Atomicity Bug Tenant', slug, is_active: true, tier: 'standard' })
      .select('id')
      .single()
    expect(tenantError).toBeNull()
    if (!tenant) throw new Error('fixture insert failed')
    createdTenantIds.push(tenant.id)

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({
        tenant_id: tenant.id,
        name: 'Atomicity Bug Tenant',
        event_type: 'Event',
        status: 'draft',
        scheduling_granularity_min: 60,
      })
      .select('id')
      .single()
    expect(eventError).toBeNull()
    if (!event) throw new Error('fixture insert failed')

    // Force the third step to fail — invalid race_type violates
    // event_stages_race_type_check (23514) — the same failure class the
    // real code has no protection against.
    const { error: stagesError } = await admin.from('event_stages').insert([
      {
        event_id: event.id,
        tenant_id: tenant.id,
        name: 'Setup',
        stage_type: 'non_race',
        race_type: 'not_a_real_race_type',
        position: 0,
      },
    ])
    expect(stagesError).not.toBeNull()

    // The bug: tenant and event survive even though stage creation failed.
    const { data: survivingTenant } = await admin
      .from('tenants')
      .select('id')
      .eq('id', tenant.id)
      .maybeSingle()
    const { data: survivingEvent } = await admin
      .from('events')
      .select('id')
      .eq('id', event.id)
      .maybeSingle()

    expect(survivingTenant).not.toBeNull()
    expect(survivingEvent).not.toBeNull()
  })

  it('the fix: create_tenant_with_defaults RPC creates tenant/event/stages atomically in one transaction', async () => {
    const admin = serviceClient()
    const slug = `atomicity-fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Called through the service client, not the signed-in system admin:
    // migration 20261015124237 made this RPC SECURITY DEFINER and granted it
    // to service_role only, since it now writes user_roles — a table no RLS
    // policy lets `authenticated` touch. The system_admin check moved into the
    // function body. The test below pins that the authenticated role is in
    // fact refused.
    const { data, error } = await admin.rpc('create_tenant_with_defaults', {
      p_name: 'Atomicity Fixed Tenant',
      p_slug: slug,
    })

    expect(error).toBeNull()
    const { tenant_id: tenantId, event_id: eventId } = data as unknown as {
      tenant_id: string
      event_id: string
    }
    expect(tenantId).toBeTruthy()
    expect(eventId).toBeTruthy()
    createdTenantIds.push(tenantId)

    const { data: stages } = await admin
      .from('event_stages')
      .select('name, position')
      .eq('event_id', eventId)
      .order('position')

    expect(stages).toEqual([
      expect.objectContaining({ name: 'Setup', position: 0 }),
      expect.objectContaining({ name: 'Race', position: 1 }),
      expect.objectContaining({ name: 'Teardown', position: 2 }),
    ])
  })

  it('the fix: a duplicate slug fails the whole transaction, leaving no partial event/stages behind', async () => {
    const admin = serviceClient()
    const slug = `atomicity-dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const { data: firstData, error: firstError } = await admin.rpc('create_tenant_with_defaults', {
      p_name: 'First Tenant',
      p_slug: slug,
    })
    expect(firstError).toBeNull()
    const { tenant_id: firstTenantId } = firstData as unknown as { tenant_id: string }
    createdTenantIds.push(firstTenantId)

    // Reusing the same slug violates tenants' unique constraint on the
    // first insert of the transaction — nothing beyond it should exist.
    const { data: secondData, error: secondError } = await admin.rpc(
      'create_tenant_with_defaults',
      { p_name: 'Second Tenant', p_slug: slug }
    )
    expect(secondError).not.toBeNull()
    expect(secondError?.code).toBe('23505')
    expect(secondData).toBeNull()

    // Only the first tenant's event/stages exist — no orphaned second event
    // was left behind by the failed call.
    const { data: events } = await admin.from('events').select('id').eq('name', 'Second Tenant')
    expect(events).toEqual([])
  })

  // N20 / ADR-0002. The RPC writes user_roles, so it must not be reachable by
  // the authenticated role even for a genuine system_admin — the app calls it
  // through the service client after its own assertSystemAdmin() check.
  it('refuses a signed-in system admin: the function is service_role only', async () => {
    const { error } = await clientSystemAdmin.rpc('create_tenant_with_defaults', {
      p_name: 'Should Not Exist',
      p_slug: `denied-${Date.now()}`,
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')

    const admin = serviceClient()
    const { data: tenants } = await admin
      .from('tenants')
      .select('id')
      .eq('name', 'Should Not Exist')
    expect(tenants).toEqual([])
  })

  // Regression guard for the PGRST203 defect: 20261015124237 added a
  // four-argument version and left the two-argument original in place, which
  // made PostgREST unable to choose between them and broke BOTH call shapes.
  // 20261015125844 dropped the original. A two-argument call must still work,
  // since the admin arguments default to null.
  it('resolves a two-argument call: there is exactly one function, not an overload pair', async () => {
    const admin = serviceClient()
    const slug = `single-signature-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const { data, error } = await admin.rpc('create_tenant_with_defaults', {
      p_name: 'Single Signature Tenant',
      p_slug: slug,
    })

    expect(error).toBeNull()
    const { tenant_id: tenantId, admin: adminResult } = data as unknown as {
      tenant_id: string
      admin: unknown
    }
    createdTenantIds.push(tenantId)

    // No admin argument given, so no admin is granted — the tenant shell the
    // old two-argument signature produced.
    expect(adminResult).toBeNull()
    const { data: roles } = await admin.from('user_roles').select('id').eq('tenant_id', tenantId)
    expect(roles).toEqual([])
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// N23 (migration 20261028104200): official_events is the membership of an
// official in an event. Tenant admins manage it; an official reads only
// their own rows, so they cannot learn of events they are not in.
describe('N23: official_events', () => {
  let tenantId: string
  let otherTenantId: string
  let event1: string
  let event2: string
  let otherTenantEvent: string
  let officialAId: string
  let officialBId: string
  let adminClient: SupabaseClient<Database>
  let otherAdminClient: SupabaseClient<Database>
  let officialAClient: SupabaseClient<Database>
  let officialBClient: SupabaseClient<Database>

  async function insertEvent(tid: string, name: string) {
    const { data, error } = await serviceClient()
      .from('events')
      .insert({ tenant_id: tid, name, event_type: 'race' })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  async function officialIdFor(userId: string) {
    const { data, error } = await serviceClient()
      .from('officials')
      .select('id')
      .eq('user_id', userId)
      .single()
    if (error) throw error
    return data.id
  }

  async function membershipsOf(officialId: string) {
    const { data } = await serviceClient()
      .from('official_events')
      .select('event_id, seen_at')
      .eq('official_id', officialId)
    return data ?? []
  }

  beforeAll(async () => {
    tenantId = (await createTenant('Official Events')).id
    otherTenantId = (await createTenant('Official Events Other')).id

    // One event first, so officials created now join it through the trigger.
    event1 = await insertEvent(tenantId, 'Viadal 2026')
    otherTenantEvent = await insertEvent(otherTenantId, 'Other')

    const officialA = await createUserWithRole(tenantId, 'official')
    const officialB = await createUserWithRole(tenantId, 'official')
    officialAId = await officialIdFor(officialA.userId)
    officialBId = await officialIdFor(officialB.userId)
    officialAClient = await signInAsClient(officialA.phone, '000000')
    officialBClient = await signInAsClient(officialB.phone, '000000')

    const admin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(admin.phone, '000000')
    const otherAdmin = await createUserWithRole(otherTenantId, 'tenant_admin')
    otherAdminClient = await signInAsClient(otherAdmin.phone, '000000')

    event2 = await insertEvent(tenantId, 'Viadal 2027')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
  })

  it("puts a new official into the tenant's only event, marked seen", async () => {
    const rows = await membershipsOf(officialAId)
    expect(rows).toHaveLength(1)
    expect(rows[0].event_id).toBe(event1)
    expect(rows[0].seen_at).not.toBeNull()
  })

  it('does not guess an event when the tenant has several', async () => {
    const late = await createUserWithRole(tenantId, 'official')
    expect(await membershipsOf(await officialIdFor(late.userId))).toEqual([])
  })

  it('lets a tenant admin add an official to another event, unseen', async () => {
    const { error } = await adminClient
      .from('official_events')
      .insert({ official_id: officialAId, event_id: event2, tenant_id: tenantId })
    expect(error).toBeNull()

    const added = (await membershipsOf(officialAId)).find((r) => r.event_id === event2)
    expect(added?.seen_at).toBeNull()
  })

  it("refuses to put an official into another tenant's event", async () => {
    const { error } = await serviceClient()
      .from('official_events')
      .insert({ official_id: officialBId, event_id: otherTenantEvent, tenant_id: tenantId })
    expect(error?.code).toBe('23503')
  })

  it("does not let another tenant's admin read or add memberships", async () => {
    const { data } = await otherAdminClient
      .from('official_events')
      .select('event_id')
      .eq('tenant_id', tenantId)
    expect(data).toEqual([])

    const { error } = await otherAdminClient
      .from('official_events')
      .insert({ official_id: officialBId, event_id: event2, tenant_id: tenantId })
    expect(error).not.toBeNull()
  })

  it('lets an official read only their own memberships', async () => {
    const { data: own } = await officialAClient.from('official_events').select('event_id')
    expect(new Set(own?.map((r) => r.event_id))).toEqual(new Set([event1, event2]))

    // B is only in event 1 and must not see that A is in event 2.
    const { data: seenByB } = await officialBClient.from('official_events').select('official_id')
    expect(seenByB?.every((r) => r.official_id === officialBId)).toBe(true)
  })

  it('does not let an official add themselves to an event', async () => {
    const { error } = await officialBClient
      .from('official_events')
      .insert({ official_id: officialBId, event_id: event2, tenant_id: tenantId })
    expect(error).not.toBeNull()
  })

  it('answers is_event_member for the caller', async () => {
    const inEvent2 = await officialAClient.rpc('is_event_member', { p_event_id: event2 })
    expect(inEvent2.data).toBe(true)
    const notInEvent2 = await officialBClient.rpc('is_event_member', { p_event_id: event2 })
    expect(notInEvent2.data).toBe(false)
  })
})

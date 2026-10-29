import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { Tier } from '@/lib/tiers/features'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// N23 (migration 20261028103213). The cap and the lock are triggers on
// events, so they are exercised through a tenant admin's own PostgREST
// session — the path that would bypass a cap kept only in an RPC.
describe('N23: per-tier event cap', () => {
  const tenantIds: string[] = []

  async function adminOf(tier: Tier) {
    const tenant = await createTenant(`Cap ${tier}`, tier)
    tenantIds.push(tenant.id)
    const admin = await createUserWithRole(tenant.id, 'tenant_admin')
    const client = await signInAsClient(admin.phone, '000000')
    return { tenantId: tenant.id, client }
  }

  function createEvent(client: SupabaseClient<Database>, tenantId: string, name: string) {
    return client
      .from('events')
      .insert({ tenant_id: tenantId, name, event_type: 'race' })
      .select('id')
      .single()
  }

  afterAll(async () => {
    for (const id of tenantIds) await cleanupTenant(id)
  })

  it('lets a standard tenant have one event and refuses a second', async () => {
    const { tenantId, client } = await adminOf('standard')
    expect((await createEvent(client, tenantId, 'One')).error).toBeNull()

    const second = await createEvent(client, tenantId, 'Two')
    expect(second.error?.code).toBe('P0001')
  })

  it('lets a premium tenant have five events and refuses a sixth', async () => {
    const { tenantId, client } = await adminOf('premium')
    for (let i = 1; i <= 5; i++) {
      expect((await createEvent(client, tenantId, `E${i}`)).error).toBeNull()
    }
    expect((await createEvent(client, tenantId, 'E6')).error?.code).toBe('P0001')
  })

  it('frees a slot when an event is archived', async () => {
    const { tenantId, client } = await adminOf('standard')
    const first = await createEvent(client, tenantId, 'Viadal 2026')
    expect(first.error).toBeNull()

    const { error: archiveError } = await client
      .from('events')
      .update({ status: 'archived' })
      .eq('id', first.data!.id)
    expect(archiveError).toBeNull()

    expect((await createEvent(client, tenantId, 'Viadal 2027')).error).toBeNull()
  })

  it('refuses to un-archive into a full tenant, and allows it once a slot is free', async () => {
    const { tenantId, client } = await adminOf('standard')
    const old = await createEvent(client, tenantId, 'Old')
    await client.from('events').update({ status: 'archived' }).eq('id', old.data!.id)
    const current = await createEvent(client, tenantId, 'Current')
    expect(current.error).toBeNull()

    const blocked = await client.from('events').update({ status: 'draft' }).eq('id', old.data!.id)
    expect(blocked.error?.code).toBe('P0001')

    await client.from('events').update({ status: 'archived' }).eq('id', current.data!.id)
    const allowed = await client.from('events').update({ status: 'draft' }).eq('id', old.data!.id)
    expect(allowed.error).toBeNull()
  })

  it('does not count draft <-> published at the cap', async () => {
    const { tenantId, client } = await adminOf('standard')
    const event = await createEvent(client, tenantId, 'Only')
    const { error } = await client
      .from('events')
      .update({ status: 'published' })
      .eq('id', event.data!.id)
    expect(error).toBeNull()
  })

  it('lets an archived event be created without counting it', async () => {
    const { tenantId, client } = await adminOf('standard')
    expect((await createEvent(client, tenantId, 'Active')).error).toBeNull()
    const { error } = await client
      .from('events')
      .insert({ tenant_id: tenantId, name: 'Historic', event_type: 'race', status: 'archived' })
    expect(error).toBeNull()
  })
})

describe('N23: archived event lock', () => {
  let tenantId: string
  let eventId: string
  let client: SupabaseClient<Database>

  beforeAll(async () => {
    const tenant = await createTenant('Archive Lock')
    tenantId = tenant.id
    const admin = await createUserWithRole(tenantId, 'tenant_admin')
    client = await signInAsClient(admin.phone, '000000')
    const { data, error } = await serviceClient()
      .from('events')
      .insert({ tenant_id: tenantId, name: 'Locked', event_type: 'race', status: 'archived' })
      .select('id')
      .single()
    if (error) throw error
    eventId = data.id
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  it('refuses edits to an archived event', async () => {
    const { error } = await client.from('events').update({ name: 'Renamed' }).eq('id', eventId)
    expect(error?.code).toBe('P0004')
  })

  it('refuses an edit smuggled in alongside un-archiving', async () => {
    const { error } = await client
      .from('events')
      .update({ status: 'draft', name: 'Renamed' })
      .eq('id', eventId)
    expect(error?.code).toBe('P0004')
  })

  it('allows un-archiving, and then editing', async () => {
    expect(
      (await client.from('events').update({ status: 'draft' }).eq('id', eventId)).error
    ).toBeNull()
    expect(
      (await client.from('events').update({ name: 'Renamed' }).eq('id', eventId)).error
    ).toBeNull()
  })
})

describe('N23: Race Results identity is per event', () => {
  let tenantId: string
  let stage2026: string
  let stage2027: string
  let client: SupabaseClient<Database>

  async function eventWithStage(name: string) {
    const admin = serviceClient()
    const { data: event, error } = await admin
      .from('events')
      .insert({ tenant_id: tenantId, name, event_type: 'race' })
      .select('id')
      .single()
    if (error) throw error
    const { data: stage, error: stageError } = await admin
      .from('event_stages')
      .insert({ tenant_id: tenantId, event_id: event.id, name: `${name} stage` })
      .select('id')
      .single()
    if (stageError) throw stageError
    return { eventId: event.id, stageId: stage.id }
  }

  function importInto(stageId: string, rows: Record<string, string>[]) {
    return client.rpc('import_participants', {
      p_tenant_id: tenantId,
      p_stage_id: stageId,
      p_rows: rows as unknown as Json,
    })
  }

  beforeAll(async () => {
    const tenant = await createTenant('RR Per Event')
    tenantId = tenant.id
    const admin = await createUserWithRole(tenantId, 'tenant_admin')
    client = await signInAsClient(admin.phone, '000000')
    stage2026 = (await eventWithStage('Viadal 2026')).stageId
    stage2027 = (await eventWithStage('Viadal 2027')).stageId
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  it("does not overwrite last year's participant who shares a Race Results id", async () => {
    const first = await importInto(stage2026, [{ external_id: '17', name: 'Anna 2026' }])
    expect(first.error).toBeNull()

    const second = await importInto(stage2027, [{ external_id: '17', name: 'Bertil 2027' }])
    expect(second.error).toBeNull()
    expect(second.data).toEqual({ inserted: 1, updated: 0, linked: 1, withdrawn: 0, revived: 0 })

    const { data } = await serviceClient()
      .from('participants')
      .select('name, event_id')
      .eq('tenant_id', tenantId)
      .eq('external_id', '17')
      .order('name')
    expect(data?.map((p) => p.name)).toEqual(['Anna 2026', 'Bertil 2027'])
    expect(new Set(data?.map((p) => p.event_id)).size).toBe(2)
  })

  it('does not withdraw or revive across events', async () => {
    // Re-importing 2027 without id 17 strikes 2027's row only.
    const result = await importInto(stage2027, [])
    expect(result.error).toBeNull()
    expect((result.data as unknown as { withdrawn: number }).withdrawn).toBe(1)

    const { data } = await serviceClient()
      .from('participants')
      .select('name, withdrawn_at')
      .eq('tenant_id', tenantId)
      .eq('external_id', '17')
      .order('name')
    expect(data?.[0].withdrawn_at).toBeNull()
    expect(data?.[1].withdrawn_at).not.toBeNull()
  })

  it('refuses a race_results participant without an event', async () => {
    const { error } = await serviceClient().from('participants').insert({
      tenant_id: tenantId,
      source: 'race_results',
      external_id: '99',
      name: 'Nobody',
    })
    // Two events in this tenant, so the fill trigger cannot choose one.
    expect(error?.code).toBe('23514')
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  cleanupTenant,
  createUserWithRole,
  signInAsClient,
} from './helpers'

// N23 (6c-2): an official reads only the events they are a member of
// (migration 20261029090324). Every read goes through a signed-in session,
// straight at PostgREST — the path the app no longer takes, and the one the
// isolation has to hold on.
describe('N23: event-member read isolation', () => {
  let tenantId: string
  let mine: string
  let theirs: string
  let officialClient: SupabaseClient<Database>
  let adminClient: SupabaseClient<Database>
  let colleagueId: string
  let strangerId: string

  type Table =
    | 'event_stages'
    | 'event_distances'
    | 'event_facilities'
    | 'workstations'
    | 'announcements'

  beforeAll(async () => {
    const admin = serviceClient()
    tenantId = (await createTenant('Event Isolation', 'premium')).id

    const { data: events, error } = await admin
      .from('events')
      .insert([
        { tenant_id: tenantId, name: 'Mine', event_type: 'race' },
        { tenant_id: tenantId, name: 'Theirs', event_type: 'race' },
      ])
      .select('id, name')
    if (error) throw error
    mine = events.find((e) => e.name === 'Mine')!.id
    theirs = events.find((e) => e.name === 'Theirs')!.id

    for (const eventId of [mine, theirs]) {
      const { error: stageError } = await admin
        .from('event_stages')
        .insert({ tenant_id: tenantId, event_id: eventId, name: 'S', stage_type: 'race' })
      if (stageError) throw stageError
      await admin
        .from('event_distances')
        .insert({ tenant_id: tenantId, event_id: eventId, label: '10 km', position: 0 })
      await admin
        .from('event_facilities')
        .insert({ tenant_id: tenantId, event_id: eventId, label: 'Toilets', position: 0 })
      const { data: ws } = await admin
        .from('workstations')
        .insert({ tenant_id: tenantId, event_id: eventId, name: 'Desk', capacity_ceiling: 1 })
        .select('id')
        .single()
      await admin.from('workstation_operating_windows').insert({
        workstation_id: ws!.id,
        window_start: '2027-06-01T08:00:00+00:00',
        window_end: '2027-06-01T18:00:00+00:00',
      })
      await admin
        .from('workstation_todos')
        .insert({ workstation_id: ws!.id, instruction_text: 'Do it', item_type: 'info' })
      const { error: annError } = await admin.from('announcements').insert({
        tenant_id: tenantId,
        event_id: eventId,
        channel: 'officials',
        body: 'Hello',
        published_at: new Date().toISOString(),
      })
      if (annError) throw annError
    }

    // The official under test, in "Mine" only.
    const official = await createUserWithRole(tenantId, 'official')
    const { data: me } = await admin
      .from('officials')
      .select('id')
      .eq('user_id', official.userId)
      .single()
    // A colleague in "Mine", and a stranger only in "Theirs".
    const { data: others } = await admin
      .from('officials')
      .insert([
        {
          tenant_id: tenantId,
          name: 'Colleague',
          phone: '+46704600001',
          invite_status: 'confirmed',
        },
        {
          tenant_id: tenantId,
          name: 'Stranger',
          phone: '+46704600002',
          invite_status: 'confirmed',
        },
      ])
      .select('id, name')
    colleagueId = others!.find((o) => o.name === 'Colleague')!.id
    strangerId = others!.find((o) => o.name === 'Stranger')!.id
    const { error: memberError } = await admin.from('official_events').upsert(
      [
        { official_id: me!.id, event_id: mine, tenant_id: tenantId },
        { official_id: colleagueId, event_id: mine, tenant_id: tenantId },
        { official_id: strangerId, event_id: theirs, tenant_id: tenantId },
      ],
      { onConflict: 'official_id,event_id', ignoreDuplicates: true }
    )
    if (memberError) throw memberError

    officialClient = await signInAsClient(official.phone, '000000')
    const tenantAdmin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(tenantAdmin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  it('shows the official only the events they are in', async () => {
    const { data } = await officialClient.from('events').select('id').eq('tenant_id', tenantId)
    expect(data?.map((e) => e.id)).toEqual([mine])
  })

  it.each([
    'event_stages',
    'event_distances',
    'event_facilities',
    'workstations',
    'announcements',
  ] as Table[])('scopes %s to the official’s event', async (table) => {
    const { data, error } = await officialClient
      .from(table)
      .select('event_id')
      .eq('tenant_id', tenantId)
    expect(error).toBeNull()
    expect(new Set(data?.map((r) => r.event_id))).toEqual(new Set([mine]))
  })

  it.each(['workstation_operating_windows', 'workstation_todos'] as const)(
    'scopes %s through the work area',
    async (table) => {
      const { data, error } = await officialClient
        .from(table)
        .select('workstations!inner(event_id)')
      expect(error).toBeNull()
      expect(data?.length).toBeGreaterThan(0)
      expect(
        new Set(data?.map((r) => (r.workstations as unknown as { event_id: string }).event_id))
      ).toEqual(new Set([mine]))
    }
  )

  it('shows the official their own row and colleagues from their events, not the rest', async () => {
    const { data } = await officialClient
      .from('officials')
      .select('id, name')
      .eq('tenant_id', tenantId)
    const names = data?.map((o) => o.name) ?? []
    expect(names).toContain('Colleague')
    expect(names).toContain('Test Official')
    expect(names).not.toContain('Stranger')
  })

  it('leaves the tenant admin reading every event and the whole roster', async () => {
    const { data: events } = await adminClient.from('events').select('id').eq('tenant_id', tenantId)
    expect(new Set(events?.map((e) => e.id))).toEqual(new Set([mine, theirs]))

    const { data: stages } = await adminClient
      .from('event_stages')
      .select('event_id')
      .eq('tenant_id', tenantId)
    expect(new Set(stages?.map((s) => s.event_id))).toEqual(new Set([mine, theirs]))

    const { data: roster } = await adminClient
      .from('officials')
      .select('id')
      .eq('tenant_id', tenantId)
    expect(roster?.map((o) => o.id)).toEqual(expect.arrayContaining([colleagueId, strangerId]))
  })

  it('opens an event to the official once they are added to it', async () => {
    const { data: me } = await officialClient
      .from('officials')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', 'Test Official')
      .single()
    await serviceClient()
      .from('official_events')
      .insert({ official_id: me!.id, event_id: theirs, tenant_id: tenantId })

    const { data } = await officialClient.from('events').select('id').eq('tenant_id', tenantId)
    expect(new Set(data?.map((e) => e.id))).toEqual(new Set([mine, theirs]))
  })
})

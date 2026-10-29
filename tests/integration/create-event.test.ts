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

// N23 / TEN-01: create_event, called the way the action calls it — as a
// signed-in tenant admin, through RLS — against the real cap trigger.
describe('N23: create_event', () => {
  let tenantId: string
  let otherTenantId: string
  let sourceId: string
  let raceStageId: string
  let undatedStageId: string
  let adminUserId: string
  let adminOfficialId: string
  let memberId: string
  let adminClient: SupabaseClient<Database>

  const ALL = {
    details: true,
    stages: true,
    distances: true,
    facilities: true,
    work_areas: true,
    checklists: true,
    officials: true,
  }

  async function createEvent(args: {
    name?: string
    source?: string | null
    copy?: Record<string, boolean>
    dates?: Record<string, string>
    client?: SupabaseClient<Database>
    tenant?: string
  }) {
    return (args.client ?? adminClient).rpc('create_event', {
      p_tenant_id: args.tenant ?? tenantId,
      p_name: args.name ?? 'Viadal 2027',
      p_source_event_id: (args.source === undefined ? sourceId : args.source) as string,
      p_copy: args.copy ?? {},
      p_stage_dates: args.dates ?? {},
    })
  }

  beforeAll(async () => {
    const admin = serviceClient()
    tenantId = (await createTenant('Create Event', 'premium')).id
    otherTenantId = (await createTenant('Create Event Other')).id

    const { data: source, error: sourceError } = await admin
      .from('events')
      .insert({
        tenant_id: tenantId,
        name: 'Viadal 2026',
        event_type: 'Ultra',
        // Archived at the end of setup: the archive lock refuses the stages
        // and work areas below once it is.
        status: 'draft',
        description: 'Six days on foot',
        location: 'Viadal',
        logo_url: 'https://example.test/logo.webp',
        scheduling_granularity_min: 60,
      })
      .select('id')
      .single()
    if (sourceError) throw sourceError
    sourceId = source.id

    const { data: stages, error: stageError } = await admin
      .from('event_stages')
      .insert([
        {
          tenant_id: tenantId,
          event_id: sourceId,
          name: 'Night stage',
          stage_type: 'race',
          race_type: 'distance',
          position: 0,
          venue: 'Start line',
          results_url: 'https://results.test/2026',
          // Runs past midnight: the copy must keep that.
          start_time: '2026-06-01T20:00:00+00:00',
          end_time: '2026-06-02T02:00:00+00:00',
        },
        {
          tenant_id: tenantId,
          event_id: sourceId,
          name: 'Briefing',
          stage_type: 'non_race',
          race_type: 'distance',
          position: 1,
        },
      ])
      .select('id, name')
    if (stageError) throw stageError
    raceStageId = stages.find((s) => s.name === 'Night stage')!.id
    undatedStageId = stages.find((s) => s.name === 'Briefing')!.id

    const { error: distanceError } = await admin.from('event_distances').insert({
      tenant_id: tenantId,
      event_id: sourceId,
      stage_id: raceStageId,
      label: '42 km',
      position: 0,
    })
    if (distanceError) throw distanceError
    const { error: facilityError } = await admin
      .from('event_facilities')
      .insert({ tenant_id: tenantId, event_id: sourceId, label: 'Showers', position: 0 })
    if (facilityError) throw facilityError

    const { data: dated, error: wsError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantId,
        event_id: sourceId,
        stage_id: raceStageId,
        name: 'Water station',
        capacity_ceiling: 4,
        color: 'sky',
      })
      .select('id')
      .single()
    if (wsError) throw wsError
    const { error: undatedWsError } = await admin.from('workstations').insert({
      tenant_id: tenantId,
      event_id: sourceId,
      stage_id: undatedStageId,
      name: 'Briefing desk',
      capacity_ceiling: 1,
    })
    if (undatedWsError) throw undatedWsError
    const { error: windowError } = await admin.from('workstation_operating_windows').insert({
      workstation_id: dated.id,
      window_start: '2026-06-01T19:00:00+00:00',
      window_end: '2026-06-02T03:00:00+00:00',
    })
    if (windowError) throw windowError
    const { error: todoError } = await admin.from('workstation_todos').insert([
      {
        workstation_id: dated.id,
        instruction_text: 'Fill the tanks',
        position: 0,
        item_type: 'info',
      },
      {
        workstation_id: dated.id,
        instruction_text: 'Collect chips',
        position: 1,
        item_type: 'checkbox',
      },
    ])
    if (todoError) throw todoError

    // The source event's officials: one on the roster, one removed from it.
    const { data: members, error: memberError } = await admin
      .from('officials')
      .insert([
        { tenant_id: tenantId, name: 'Member', phone: '+46704300001', invite_status: 'confirmed' },
        { tenant_id: tenantId, name: 'Gone', phone: '+46704300002', invite_status: 'removed' },
      ])
      .select('id, name')
    if (memberError) throw memberError
    memberId = members.find((m) => m.name === 'Member')!.id
    const { error: membershipError } = await admin
      .from('official_events')
      // Upsert: while the source is the tenant's only active event,
      // officials_join_sole_event has already added these memberships.
      .upsert(
        members.map((m) => ({ official_id: m.id, event_id: sourceId, tenant_id: tenantId })),
        { onConflict: 'official_id,event_id', ignoreDuplicates: true }
      )
    if (membershipError) throw membershipError

    const { error: archiveError } = await admin
      .from('events')
      .update({ status: 'archived' })
      .eq('id', sourceId)
    if (archiveError) throw archiveError

    const created = await createUserWithRole(tenantId, 'tenant_admin')
    adminUserId = created.userId
    const { data: rosterRow, error: rosterError } = await admin
      .from('officials')
      .insert({
        tenant_id: tenantId,
        user_id: adminUserId,
        name: 'Admin',
        phone: created.phone,
        invite_status: 'confirmed',
      })
      .select('id')
      .single()
    if (rosterError) throw rosterError
    adminOfficialId = rosterRow.id
    adminClient = await signInAsClient(created.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
  })

  it('creates a blank draft with the default stages, and the admin as a seen member', async () => {
    const { data, error } = await createEvent({ name: '  Blank  ', source: null })
    expect(error).toBeNull()
    // The return shape the action reads.
    expect(Object.keys(data as object)).toEqual(['event_id'])
    const eventId = (data as { event_id: string }).event_id

    const admin = serviceClient()
    const { data: event } = await admin
      .from('events')
      .select('name, status, event_type, start_date')
      .eq('id', eventId)
      .single()
    expect(event).toEqual({ name: 'Blank', status: 'draft', event_type: 'Event', start_date: null })

    const { data: stages } = await admin
      .from('event_stages')
      .select('name')
      .eq('event_id', eventId)
      .order('position')
    expect(stages?.map((s) => s.name)).toEqual(['Setup', 'Race', 'Teardown'])

    const { data: members } = await admin
      .from('official_events')
      .select('official_id, seen_at')
      .eq('event_id', eventId)
    expect(members).toHaveLength(1)
    expect(members![0].official_id).toBe(adminOfficialId)
    expect(members![0].seen_at).not.toBeNull()
  })

  it('copies everything ticked, moving dates by whole days', async () => {
    const { data, error } = await createEvent({
      copy: ALL,
      // A year on, the same weekday: 364 days after 2026-06-01.
      dates: { [raceStageId]: '2027-05-31' },
    })
    expect(error).toBeNull()
    const eventId = (data as { event_id: string }).event_id
    const admin = serviceClient()

    const { data: event } = await admin
      .from('events')
      .select('event_type, description, location, logo_url, start_date, end_date')
      .eq('id', eventId)
      .single()
    expect(event).toEqual({
      event_type: 'Ultra',
      description: 'Six days on foot',
      location: 'Viadal',
      logo_url: null,
      start_date: '2027-05-31',
      end_date: '2027-06-01',
    })

    const { data: stages } = await admin
      .from('event_stages')
      .select('id, name, start_time, end_time, venue, results_url')
      .eq('event_id', eventId)
      .order('position')
    expect(stages?.map((s) => s.name)).toEqual(['Night stage', 'Briefing'])
    const night = stages![0]
    expect(new Date(night.start_time!).toISOString()).toBe('2027-05-31T20:00:00.000Z')
    expect(new Date(night.end_time!).toISOString()).toBe('2027-06-01T02:00:00.000Z')
    expect(night.venue).toBe('Start line')
    expect(night.results_url).toBeNull()
    expect(stages![1].start_time).toBeNull()

    const { data: distances } = await admin
      .from('event_distances')
      .select('label, stage_id')
      .eq('event_id', eventId)
    expect(distances).toEqual([{ label: '42 km', stage_id: night.id }])

    const { data: facilities } = await admin
      .from('event_facilities')
      .select('label')
      .eq('event_id', eventId)
    expect(facilities).toEqual([{ label: 'Showers' }])

    const { data: workAreas } = await admin
      .from('workstations')
      .select(
        'name, stage_id, capacity_ceiling, color, workstation_operating_windows(window_start, window_end), workstation_todos(instruction_text, item_type, position)'
      )
      .eq('event_id', eventId)
      .order('name')
    expect(workAreas).toHaveLength(2)
    const [desk, water] = workAreas!
    // On an undated stage: copied, but without windows.
    expect(desk.workstation_operating_windows).toEqual([])
    expect(water.stage_id).toBe(night.id)
    expect(water.capacity_ceiling).toBe(4)
    expect(water.color).toBe('sky')
    expect(
      water.workstation_operating_windows.map((w) => [
        new Date(w.window_start).toISOString(),
        new Date(w.window_end).toISOString(),
      ])
    ).toEqual([['2027-05-31T19:00:00.000Z', '2027-06-01T03:00:00.000Z']])
    expect(
      [...water.workstation_todos]
        .sort((a, b) => a.position - b.position)
        .map((t) => [t.instruction_text, t.item_type])
    ).toEqual([
      ['Fill the tanks', 'info'],
      ['Collect chips', 'checkbox'],
    ])

    // The admin, already seen; the source's roster member, unseen so they get
    // the notice; not the official removed from the roster.
    const { data: memberships } = await admin
      .from('official_events')
      .select('official_id, seen_at')
      .eq('event_id', eventId)
    expect(
      Object.fromEntries(memberships!.map((m) => [m.official_id, m.seen_at === null]))
    ).toEqual({ [adminOfficialId]: false, [memberId]: true })
  })

  it('copies only what is ticked', async () => {
    const { data, error } = await createEvent({
      copy: { stages: true },
      dates: { [raceStageId]: '2027-06-07' },
    })
    expect(error).toBeNull()
    const eventId = (data as { event_id: string }).event_id
    const admin = serviceClient()

    const { data: event } = await admin
      .from('events')
      .select('description')
      .eq('id', eventId)
      .single()
    expect(event?.description).toBeNull()
    for (const table of ['event_distances', 'event_facilities', 'workstations'] as const) {
      const { count } = await admin
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId)
      expect(count).toBe(0)
    }
    const { data: memberships } = await admin
      .from('official_events')
      .select('official_id')
      .eq('event_id', eventId)
    expect(memberships).toEqual([{ official_id: adminOfficialId }])
  })

  it.each([
    ['a dated stage without a date', { stages: true }, {}],
    ['distances without stages', { distances: true }, {}],
    ['checklists without work areas', { stages: true, checklists: true }, {}],
  ])('refuses %s and writes nothing', async (_label, copy, dates) => {
    const before = await serviceClient()
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)

    const { error } = await createEvent({ copy, dates })
    expect(error?.code).toBe('22023')

    const after = await serviceClient()
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    expect(after.count).toBe(before.count)
  })

  it("does not copy from another tenant's event", async () => {
    const { data: foreign } = await serviceClient()
      .from('events')
      .insert({ tenant_id: otherTenantId, name: 'Not ours', event_type: 'race' })
      .select('id')
      .single()

    const { error } = await createEvent({ source: foreign!.id, copy: { details: true } })
    expect(error?.code).toBe('P0002')
  })

  it("refuses a caller who is not this tenant's admin", async () => {
    const outsider = await createUserWithRole(otherTenantId, 'tenant_admin')
    const outsiderClient = await signInAsClient(outsider.phone, '000000')

    const { error } = await createEvent({ client: outsiderClient, source: null })
    expect(error).not.toBeNull()
  })

  it('stops at the tier cap with P0001', async () => {
    // Premium allows 5 active events; the archived source does not count.
    const { count } = await serviceClient()
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .neq('status', 'archived')
    for (let i = count ?? 0; i < 5; i++) {
      const { error } = await createEvent({ name: `Filler ${i}`, source: null })
      expect(error).toBeNull()
    }

    const { error } = await createEvent({ name: 'One too many', source: null })
    expect(error?.code).toBe('P0001')
  })
})

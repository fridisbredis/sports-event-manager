import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// EVT-02 (migration 0058): sync_event_stages rejects a call that would leave
// a published event with zero Race stages. The unit tests in actions.test.ts
// only mock supabase.rpc, so they prove saveEvent handles a returned error
// string correctly — they prove nothing about whether the SQL itself raises.
// Only a real call against Postgres can catch a future replace-migration
// silently dropping this guard, exactly the failure mode that took the
// role_granted key out of confirm_official_invite_by_phone between
// migrations 0043 and 0045.
//
// F-REL-22 (migration 20260909130951): the Race-stage guard's SQLSTATE was
// changed from 23514 to a custom P0003 so the app layer can tell it apart
// from event_stages_times_order_check, which also raises plain 23514 from
// the same function's INSERT ... ON CONFLICT UPDATE. A mocked unit test
// cannot prove this discrimination — see the P0003-vs-23514 test below,
// which asserts both codes from one real Postgres session.
//
// Migration 20260908143523 closed the TOCTOU race between this function and
// publish_event by adding SELECT ... FOR UPDATE to both functions' events
// read. supabase-js/PostgREST has no way to hold one transaction open across
// two separate async calls, so the actual concurrent-lock behavior (session
// B blocks until session A's transaction commits, then re-checks under the
// now-current row state) was verified manually against the local stack with
// two overlapping psql sessions — see the "Verify with" section at the
// bottom of that migration file for the exact steps. The tests below are
// sequential regression coverage: they prove publish_event and
// sync_event_stages still behave correctly individually now that both take
// the lock, not that the lock itself works (a single test process can't
// demonstrate blocking against itself).
describe('sync_event_stages RPC: published-event Race-stage guard', () => {
  let tenant: { id: string }
  let clientAdmin: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenant = await createTenant('Tenant SyncEventStagesGuard')
    const admin = await createUserWithRole(tenant.id, 'tenant_admin')
    clientAdmin = await signInAsClient(admin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
  })

  async function createEvent(status: 'draft' | 'published') {
    const admin = serviceClient()
    const { data, error } = await admin
      .from('events')
      .insert({
        tenant_id: tenant.id,
        name: 'Guard Test Event',
        event_type: 'race',
        status,
      })
      .select()
      .single()
    if (error) throw error
    return data
  }

  async function raceStagePayload() {
    return [
      {
        name: 'Stage 1',
        stage_type: 'race',
        race_type: 'distance',
        start_time: '2026-06-01T08:00:00Z',
        end_time: '2026-06-01T10:00:00Z',
        venue: 'Start line',
        position: 0,
        distances: [],
      },
    ]
  }

  async function countRaceStages(eventId: string) {
    const admin = serviceClient()
    const { count, error } = await admin
      .from('event_stages')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('stage_type', 'race')
    if (error) throw error
    return count ?? 0
  }

  it('rejects retyping the only Race stage to non_race on a published event (P0003)', async () => {
    const event = await createEvent('draft')
    const { error: seedError } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
      p_stages: await raceStagePayload(),
    })
    expect(seedError).toBeNull()

    const admin = serviceClient()
    const { error: publishError } = await admin
      .from('events')
      .update({ status: 'published' })
      .eq('id', event.id)
    expect(publishError).toBeNull()

    const { data: existingStages } = await admin
      .from('event_stages')
      .select('id')
      .eq('event_id', event.id)
    const stageId = existingStages?.[0]?.id
    if (!stageId) throw new Error('fixture stage not found')

    const { error } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
      p_stages: [
        {
          ...(await raceStagePayload())[0],
          id: stageId,
          stage_type: 'non_race',
        },
      ],
    })

    expect(error?.code).toBe('P0003')
    expect(error?.message).toContain('Cannot remove the last Race stage from a published event.')
    // The whole call must have rolled back — the row is still a Race stage.
    expect(await countRaceStages(event.id)).toBe(1)
  })

  it('rejects emptying all stages from a published event (P0003)', async () => {
    const event = await createEvent('draft')
    const { error: seedError } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
      p_stages: await raceStagePayload(),
    })
    expect(seedError).toBeNull()

    const admin = serviceClient()
    const { error: publishError } = await admin
      .from('events')
      .update({ status: 'published' })
      .eq('id', event.id)
    expect(publishError).toBeNull()

    const { error } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
      p_stages: [],
    })

    expect(error?.code).toBe('P0003')
    // Rolled back — the original Race stage must still be there.
    expect(await countRaceStages(event.id)).toBe(1)
  })

  it('allows the same call to succeed on a draft event', async () => {
    const event = await createEvent('draft')
    const { error: seedError } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
      p_stages: await raceStagePayload(),
    })
    expect(seedError).toBeNull()

    const { error } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
      p_stages: [],
    })

    expect(error).toBeNull()
    expect(await countRaceStages(event.id)).toBe(0)
  })

  it('distinguishes the Race-stage guard (P0003) from event_stages_times_order_check (23514)', async () => {
    // F-REL-22: both raises happen inside sync_event_stages. Only a real
    // Postgres call proves they carry different SQLSTATEs — a mock can be
    // told to return whatever code the test author expects.
    const publishedEvent = await createEvent('draft')
    const { error: seedError } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: publishedEvent.id,
      p_tenant_id: tenant.id,
      p_stages: await raceStagePayload(),
    })
    expect(seedError).toBeNull()
    const admin = serviceClient()
    await admin.from('events').update({ status: 'published' }).eq('id', publishedEvent.id)

    const { error: raceStageError } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: publishedEvent.id,
      p_tenant_id: tenant.id,
      p_stages: [],
    })
    expect(raceStageError?.code).toBe('P0003')

    const draftEvent = await createEvent('draft')
    const { error: timesOrderError } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: draftEvent.id,
      p_tenant_id: tenant.id,
      p_stages: [
        {
          name: 'Backwards stage',
          stage_type: 'race',
          race_type: 'time',
          start_time: '2026-06-01T10:00:00Z',
          end_time: '2026-06-01T08:00:00Z',
          venue: '',
          position: 0,
          distances: [],
        },
      ],
    })
    expect(timesOrderError?.code).toBe('23514')
    expect(timesOrderError?.code).not.toBe(raceStageError?.code)
  })

  // SEC-01 (migration 20260909123808): event_distances.stage_id got a
  // composite (stage_id, tenant_id) FK. A plain multi-column ON DELETE SET
  // NULL nulls every column in the FK, including tenant_id — which is
  // NOT NULL on event_distances — so sync_event_stages's own
  // `DELETE FROM event_stages WHERE ... id <> ALL(...)` statement (which
  // runs before this function's later unconditional
  // `DELETE FROM event_distances`) would raise a not-null violation the
  // instant a removed stage still has a distance row pointing at it,
  // aborting the whole call. The migration fixes this with the PG15+
  // column-scoped `ON DELETE SET NULL (stage_id)` syntax, so only stage_id
  // is nulled and tenant_id is left alone — after which this function's own
  // unconditional distances DELETE/INSERT still fully replaces the set as
  // designed. This test only needs to prove the stage removal itself no
  // longer errors; it does not assert on the (momentarily nulled, then
  // deleted) intermediate distance row.
  it('removes a stage with distances attached without erroring', async () => {
    const event = await createEvent('draft')
    const { error: seedError } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
      p_stages: await raceStagePayload(),
    })
    expect(seedError).toBeNull()

    const admin = serviceClient()
    const { data: stage, error: stageError } = await admin
      .from('event_stages')
      .select('id')
      .eq('event_id', event.id)
      .single()
    if (stageError) throw stageError

    const { error: distanceError } = await admin.from('event_distances').insert({
      tenant_id: tenant.id,
      event_id: event.id,
      stage_id: stage.id,
      label: 'Distance on stage to be removed',
    })
    if (distanceError) throw distanceError

    // Replace with a different-named Race stage (no id), which is treated
    // as removing the old stage and inserting a new one — the exact
    // "edit an event, remove a stage that has distances" flow the bug
    // report described.
    const { error } = await clientAdmin.rpc('sync_event_stages', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
      p_stages: [
        {
          name: 'Replacement Stage',
          stage_type: 'race',
          race_type: 'distance',
          start_time: '2026-06-01T08:00:00Z',
          end_time: '2026-06-01T10:00:00Z',
          venue: 'Start line',
          position: 0,
          distances: [],
        },
      ],
    })

    expect(error).toBeNull()
    expect(await countRaceStages(event.id)).toBe(1)
  })
})

describe('publish_event RPC', () => {
  let tenant: { id: string }
  let clientAdmin: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenant = await createTenant('Tenant PublishEventRpc')
    const admin = await createUserWithRole(tenant.id, 'tenant_admin')
    clientAdmin = await signInAsClient(admin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
  })

  async function createEvent(overrides: { name?: string; status?: 'draft' | 'published' } = {}) {
    const admin = serviceClient()
    const { data, error } = await admin
      .from('events')
      .insert({
        tenant_id: tenant.id,
        name: overrides.name ?? 'Publish Test Event',
        event_type: 'race',
        status: overrides.status ?? 'draft',
      })
      .select()
      .single()
    if (error) throw error
    return data
  }

  async function addRaceStage(eventId: string) {
    const admin = serviceClient()
    const { error } = await admin.from('event_stages').insert({
      event_id: eventId,
      tenant_id: tenant.id,
      name: 'Stage 1',
      stage_type: 'race',
      race_type: 'distance',
      position: 0,
    })
    if (error) throw error
  }

  it('publishes an event that has a Race stage and reports it as a real transition', async () => {
    const event = await createEvent()
    await addRaceStage(event.id)

    const { data: didPublish, error } = await clientAdmin.rpc('publish_event', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
    })
    expect(error).toBeNull()
    expect(didPublish).toBe(true)

    const admin = serviceClient()
    const { data } = await admin.from('events').select('status').eq('id', event.id).single()
    expect(data?.status).toBe('published')
  })

  it('rejects publishing an event with zero Race stages (23514)', async () => {
    const event = await createEvent()

    const { error } = await clientAdmin.rpc('publish_event', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
    })

    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('Add at least one Race stage before publishing.')

    const admin = serviceClient()
    const { data } = await admin.from('events').select('status').eq('id', event.id).single()
    expect(data?.status).toBe('draft')
  })

  it('rejects publishing an event with a blank name (23514)', async () => {
    const event = await createEvent({ name: '   ' })
    await addRaceStage(event.id)

    const { error } = await clientAdmin.rpc('publish_event', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
    })

    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('Event name is required before publishing.')
  })

  it('is a no-op when the event is already published, reported via a false return', async () => {
    const event = await createEvent({ status: 'published' })
    await addRaceStage(event.id)

    const { data: didPublish, error } = await clientAdmin.rpc('publish_event', {
      p_event_id: event.id,
      p_tenant_id: tenant.id,
    })

    expect(error).toBeNull()
    expect(didPublish).toBe(false)

    const admin = serviceClient()
    const { data } = await admin.from('events').select('status').eq('id', event.id).single()
    expect(data?.status).toBe('published')
  })

  it('raises P0002 for an event id that does not exist under this tenant', async () => {
    const { error } = await clientAdmin.rpc('publish_event', {
      p_event_id: '00000000-0000-0000-0000-000000000000',
      p_tenant_id: tenant.id,
    })

    expect(error?.code).toBe('P0002')
  })
})

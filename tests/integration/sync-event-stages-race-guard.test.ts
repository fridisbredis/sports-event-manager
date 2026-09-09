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

  it('rejects retyping the only Race stage to non_race on a published event (23514)', async () => {
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

    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('Cannot remove the last Race stage from a published event.')
    // The whole call must have rolled back — the row is still a Race stage.
    expect(await countRaceStages(event.id)).toBe(1)
  })

  it('rejects emptying all stages from a published event (23514)', async () => {
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

    expect(error?.code).toBe('23514')
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

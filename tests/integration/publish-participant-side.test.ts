import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  signInAsClient,
  cleanupTenant,
  createParticipantLinkedToUser,
} from './helpers'

// N36 (migration 20261106123522): publish opens the participant side and is
// Premium and up — refused by publish_event itself for a Standard tenant, not
// only by the server action and the greyed-out button. Run against real
// Postgres, through signed-in sessions straight at PostgREST: the path a
// caller would take to get past the server action.
type Client = SupabaseClient<Database>

async function createEvent(tenantId: string, status: 'draft' | 'published' = 'draft') {
  const admin = serviceClient()
  const { data, error } = await admin
    .from('events')
    .insert({ tenant_id: tenantId, name: 'Publish N36', event_type: 'race', status })
    .select('id')
    .single()
  if (error) throw error
  const { error: stageError } = await admin.from('event_stages').insert({
    tenant_id: tenantId,
    event_id: data.id,
    name: 'Race',
    stage_type: 'race',
    race_type: 'distance',
    position: 0,
  })
  if (stageError) throw stageError
  return data.id
}

async function statusOf(eventId: string) {
  const { data, error } = await serviceClient()
    .from('events')
    .select('status')
    .eq('id', eventId)
    .single()
  if (error) throw error
  return data.status
}

describe('N36: publish_event tier gate', () => {
  let standardTenant: string
  let premiumTenant: string
  let standardAdmin: Client
  let premiumAdmin: Client
  const extraTenants: string[] = []

  beforeAll(async () => {
    standardTenant = (await createTenant('N36 Standard', 'standard')).id
    premiumTenant = (await createTenant('N36 Premium', 'premium')).id
    const sa = await createUserWithRole(standardTenant, 'tenant_admin')
    const pa = await createUserWithRole(premiumTenant, 'tenant_admin')
    standardAdmin = await signInAsClient(sa.phone, '000000')
    premiumAdmin = await signInAsClient(pa.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(standardTenant)
    await cleanupTenant(premiumTenant)
    for (const id of extraTenants) await cleanupTenant(id)
  })

  it('refuses a Standard tenant with P0005 and leaves the event a draft', async () => {
    const eventId = await createEvent(standardTenant)

    const { data, error } = await standardAdmin.rpc('publish_event', {
      p_event_id: eventId,
      p_tenant_id: standardTenant,
    })

    expect(data).toBeNull()
    expect(error?.code).toBe('P0005')
    expect(await statusOf(eventId)).toBe('draft')
  })

  it('returns the no-op false, not an error, for a Standard event already stored as published', async () => {
    // Standard's event cap is 1, so the stored-published case (from before a
    // downgrade) needs a tenant of its own.
    const downgraded = (await createTenant('N36 Downgraded', 'standard')).id
    extraTenants.push(downgraded)
    const eventId = await createEvent(downgraded, 'published')
    const da = await createUserWithRole(downgraded, 'tenant_admin')
    const downgradedAdmin = await signInAsClient(da.phone, '000000')

    const { data, error } = await downgradedAdmin.rpc('publish_event', {
      p_event_id: eventId,
      p_tenant_id: downgraded,
    })

    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('publishes on Premium and keeps the boolean return contract', async () => {
    const eventId = await createEvent(premiumTenant)

    const first = await premiumAdmin.rpc('publish_event', {
      p_event_id: eventId,
      p_tenant_id: premiumTenant,
    })
    expect(first.error).toBeNull()
    expect(first.data).toBe(true)
    expect(await statusOf(eventId)).toBe('published')

    const again = await premiumAdmin.rpc('publish_event', {
      p_event_id: eventId,
      p_tenant_id: premiumTenant,
    })
    expect(again.error).toBeNull()
    expect(again.data).toBe(false)
  })

  it('refuses an archived event with P0004 instead of un-archiving it', async () => {
    const eventId = await createEvent(premiumTenant)
    const { error: archiveError } = await serviceClient()
      .from('events')
      .update({ status: 'archived' })
      .eq('id', eventId)
    if (archiveError) throw archiveError

    const { error } = await premiumAdmin.rpc('publish_event', {
      p_event_id: eventId,
      p_tenant_id: premiumTenant,
    })

    expect(error?.code).toBe('P0004')
    expect(await statusOf(eventId)).toBe('archived')
  })

  it("cannot publish another tenant's event (P0002)", async () => {
    const eventId = await createEvent(premiumTenant)

    const { error } = await standardAdmin.rpc('publish_event', {
      p_event_id: eventId,
      p_tenant_id: premiumTenant,
    })

    expect(error?.code).toBe('P0002')
    expect(await statusOf(eventId)).toBe('draft')
  })
})

// "Publish, then unpublish, then publish again: claims and accounts
// unchanged." Unpublish is the same guarded UPDATE unpublishEvent sends.
describe('N36: publish -> unpublish -> publish keeps participants and claims', () => {
  let tenantId: string
  let adminClient: Client
  let eventId: string
  let participantId: string
  let participantUserId: string

  beforeAll(async () => {
    tenantId = (await createTenant('N36 Round Trip', 'premium')).id
    const admin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(admin.phone, '000000')
    eventId = await createEvent(tenantId)
    // A claimed participant: the row is linked to an auth user (the claim)
    // and the user has a participant role (the account).
    const participant = await createUserWithRole(tenantId, 'participant')
    participantUserId = participant.userId
    participantId = (
      await createParticipantLinkedToUser(tenantId, eventId, participantUserId, 'Lisa Nord')
    ).id
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  async function snapshot() {
    const admin = serviceClient()
    const { data: participants, error } = await admin
      .from('participants')
      .select('*')
      .eq('event_id', eventId)
      .order('id')
    if (error) throw error
    const { data: roles, error: rolesError } = await admin
      .from('user_roles')
      .select('*')
      .eq('user_id', participantUserId)
      .order('id')
    if (rolesError) throw rolesError
    const { data: user } = await admin.auth.admin.getUserById(participantUserId)
    return { participants, roles, userId: user.user?.id }
  }

  async function unpublish() {
    const { data, error } = await adminClient
      .from('events')
      .update({ status: 'draft' })
      .eq('id', eventId)
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .select('id')
    expect(error).toBeNull()
    return data
  }

  it('keeps every participant row, claim and account across the round trip', async () => {
    const before = await snapshot()
    expect(before.participants).toHaveLength(1)
    expect(before.participants![0].id).toBe(participantId)
    expect(before.participants![0].user_id).toBe(participantUserId)

    const p1 = await adminClient.rpc('publish_event', {
      p_event_id: eventId,
      p_tenant_id: tenantId,
    })
    expect(p1.error).toBeNull()
    expect(await statusOf(eventId)).toBe('published')

    expect(await unpublish()).toHaveLength(1)
    expect(await statusOf(eventId)).toBe('draft')
    // A second unpublish of a draft is a no-op, not a change.
    expect(await unpublish()).toHaveLength(0)

    const p2 = await adminClient.rpc('publish_event', {
      p_event_id: eventId,
      p_tenant_id: tenantId,
    })
    expect(p2.error).toBeNull()
    expect(p2.data).toBe(true)

    expect(await snapshot()).toEqual(before)
  })
})

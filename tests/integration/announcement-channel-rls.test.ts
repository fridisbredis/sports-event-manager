import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  cleanupTenant,
  createUserWithRole,
  createUserWithoutRole,
  createOfficialLinkedToUser,
  createParticipantLinkedToUser,
  deleteAuthUser,
  signInAsClient,
} from './helpers'

// N44: "Officials never see the participant channel and vice versa"
// (migration 20261111100330). Each read is a real session straight at
// PostgREST, so this is the database's answer, not the app's filtering.
describe('N44: announcement channels are kept apart by RLS', () => {
  let tenantId: string
  let eventId: string
  let officialClient: SupabaseClient<Database>
  let participantClient: SupabaseClient<Database>
  let dualClient: SupabaseClient<Database>
  let adminClient: SupabaseClient<Database>
  const ownUsers: string[] = []

  async function officialInEvent(userId: string) {
    const official = await createOfficialLinkedToUser(tenantId, userId, 'Official')
    const admin = serviceClient()
    const { error: roleError } = await admin
      .from('user_roles')
      .insert({ user_id: userId, tenant_id: tenantId, role: 'official' })
    if (roleError) throw roleError
    // Upsert: with a single event in the tenant, the official may already be
    // linked to it by the time this runs.
    const { error } = await admin
      .from('official_events')
      .upsert(
        { tenant_id: tenantId, event_id: eventId, official_id: official.id },
        { onConflict: 'official_id,event_id', ignoreDuplicates: true }
      )
    if (error) throw error
  }

  beforeAll(async () => {
    const admin = serviceClient()
    tenantId = (await createTenant('Announcement Channel RLS', 'premium')).id

    const { data: event, error } = await admin
      .from('events')
      .insert({ tenant_id: tenantId, name: 'Race', event_type: 'race', status: 'published' })
      .select('id')
      .single()
    if (error) throw error
    eventId = event.id

    const { error: annError } = await admin.from('announcements').insert(
      (['officials', 'participants'] as const).map((channel) => ({
        tenant_id: tenantId,
        event_id: eventId,
        channel,
        body: `To ${channel}`,
        published_at: new Date().toISOString(),
      }))
    )
    if (annError) throw annError

    const official = await createUserWithoutRole()
    ownUsers.push(official.userId)
    await officialInEvent(official.userId)
    officialClient = await signInAsClient(official.phone, '000000')

    const participant = await createUserWithoutRole()
    ownUsers.push(participant.userId)
    await createParticipantLinkedToUser(tenantId, eventId, participant.userId, 'Runner')
    participantClient = await signInAsClient(participant.phone, '000000')

    // An official in the event who has also claimed a participant record in it.
    const dual = await createUserWithoutRole()
    ownUsers.push(dual.userId)
    await officialInEvent(dual.userId)
    await createParticipantLinkedToUser(tenantId, eventId, dual.userId, 'Both')
    dualClient = await signInAsClient(dual.phone, '000000')

    const tenantAdmin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(tenantAdmin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    for (const userId of ownUsers) await deleteAuthUser(userId)
  })

  async function channelsReadBy(client: SupabaseClient<Database>) {
    const { data, error } = await client
      .from('announcements')
      .select('channel')
      .eq('tenant_id', tenantId)
      .eq('event_id', eventId)
    expect(error).toBeNull()
    return (data ?? []).map((a) => a.channel).sort()
  }

  it('lets an official read the officials channel only', async () => {
    expect(await channelsReadBy(officialClient)).toEqual(['officials'])
  })

  it('lets a participant read the participant channel only', async () => {
    expect(await channelsReadBy(participantClient)).toEqual(['participants'])
  })

  it('lets someone who is both read both, each through its own role', async () => {
    expect(await channelsReadBy(dualClient)).toEqual(['officials', 'participants'])
  })

  it('lets a tenant admin read both', async () => {
    expect(await channelsReadBy(adminClient)).toEqual(['officials', 'participants'])
  })
})

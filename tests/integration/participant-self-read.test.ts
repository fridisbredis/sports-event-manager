import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  cleanupTenant,
  createUserWithoutRole,
  createParticipantLinkedToUser,
  deleteAuthUser,
  signInAsClient,
} from './helpers'

// N43: what a signed-in participant reads (migration 20261110133030). Every
// read goes through a real session straight at PostgREST, so this is the RLS
// the participant screens rely on, not the app's own filtering.
describe('N43: participant self-read policies', () => {
  let tenantId: string
  let mine: string
  let theirs: string
  let userId: string
  let participantClient: SupabaseClient<Database>
  let myParticipantId: string
  let otherParticipantId: string
  const raceStage: Record<string, string> = {}

  beforeAll(async () => {
    const admin = serviceClient()
    tenantId = (await createTenant('Participant Self Read', 'premium')).id

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
      const { data: stages, error: stageError } = await admin
        .from('event_stages')
        .insert([
          { tenant_id: tenantId, event_id: eventId, name: 'Race', stage_type: 'race' },
          { tenant_id: tenantId, event_id: eventId, name: 'Expo', stage_type: 'non_race' },
        ])
        .select('id, stage_type')
      if (stageError) throw stageError
      raceStage[eventId] = stages.find((s) => s.stage_type === 'race')!.id

      const { error: sectionError } = await admin
        .from('event_info_sections')
        .insert({ tenant_id: tenantId, event_id: eventId, title: 'Parking', body: 'North lot' })
      if (sectionError) throw sectionError

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
    }

    // The participant under test, entered in "Mine" only.
    const user = await createUserWithoutRole()
    userId = user.userId
    myParticipantId = (await createParticipantLinkedToUser(tenantId, mine, userId, 'Runner')).id

    // Another runner in the same event, not linked to the user.
    const { data: other, error: otherError } = await admin
      .from('participants')
      .insert({ tenant_id: tenantId, event_id: mine, name: 'Someone else' })
      .select('id')
      .single()
    if (otherError) throw otherError
    otherParticipantId = other.id

    const { error: psError } = await admin.from('participant_stages').insert([
      { tenant_id: tenantId, participant_id: myParticipantId, stage_id: raceStage[mine] },
      { tenant_id: tenantId, participant_id: otherParticipantId, stage_id: raceStage[mine] },
    ])
    if (psError) throw psError

    participantClient = await signInAsClient(user.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await deleteAuthUser(userId)
  })

  it('shows only the participant’s own stage entries', async () => {
    const { data, error } = await participantClient
      .from('participant_stages')
      .select('participant_id, stage_id')
      .eq('tenant_id', tenantId)
    expect(error).toBeNull()
    expect(data).toEqual([{ participant_id: myParticipantId, stage_id: raceStage[mine] }])
  })

  // Stages and info sections are read through get_event_info_cached, with
  // the app deciding access (N38's decision) — never directly.
  it.each(['event_stages', 'event_info_sections'] as const)(
    'gives the participant no direct read of %s',
    async (table) => {
      const { data, error } = await participantClient
        .from(table)
        .select('id')
        .eq('tenant_id', tenantId)
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
  )

  it('shows only participant-channel announcements of the participant’s own event', async () => {
    const { data, error } = await participantClient
      .from('announcements')
      .select('event_id, channel')
      .eq('tenant_id', tenantId)
    expect(error).toBeNull()
    expect(data).toEqual([{ event_id: mine, channel: 'participants' }])
  })

  it('still hides other runners’ participant rows', async () => {
    const { data, error } = await participantClient
      .from('participants')
      .select('id')
      .eq('tenant_id', tenantId)
    expect(error).toBeNull()
    expect(data?.map((p) => p.id)).toEqual([myParticipantId])
  })

  it('loses every read once unlinked', async () => {
    const admin = serviceClient()
    const { error } = await admin
      .from('participants')
      .update({ user_id: null })
      .eq('id', myParticipantId)
    if (error) throw error

    for (const table of ['participant_stages', 'announcements'] as const) {
      const { data } = await participantClient
        .from(table)
        .select('tenant_id')
        .eq('tenant_id', tenantId)
      expect(data, table).toEqual([])
    }
  })
})

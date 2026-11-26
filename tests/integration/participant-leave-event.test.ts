import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  cleanupTenant,
  createUserWithoutRole,
  deleteAuthUser,
  signInAsClient,
} from './helpers'

// N74 / migration 20261126144947: a participant leaves an event themselves.
//
// Against real Postgres because what the card's done-when names lives in
// SQL: leave_own_participant_entry clearing only the caller's own row (the
// WHERE user_id = auth.uid() gate), the participants_sync_participant_role
// trigger keeping the role while another entry remains, the audit row, and
// the jsonb shape leaveParticipantEvent reads (F-REL-16). The calls run with
// the runner's own session, the client the action uses.

type LeaveResult = {
  left: boolean
  tenant_id?: string
  event_id?: string
  avatar_url?: string | null
}

describe('N74: participant leaves an event', () => {
  let tenantId: string
  let eventA: string
  let eventB: string
  const extraUsers: string[] = []

  async function addEvent(name: string) {
    const { data, error } = await serviceClient()
      .from('events')
      .insert({ tenant_id: tenantId, name, event_type: 'race' })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  async function addParticipant(name: string, eventId: string) {
    const { data, error } = await serviceClient()
      .from('participants')
      .insert({ tenant_id: tenantId, event_id: eventId, name })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  async function runner() {
    const user = await createUserWithoutRole()
    extraUsers.push(user.userId)
    return user
  }

  async function claim(userId: string, participantId: string, eventId: string) {
    const { error } = await serviceClient().rpc('complete_participant_claim', {
      p_user_id: userId,
      p_participant_id: participantId,
      p_tenant_id: tenantId,
      p_event_id: eventId,
      p_privacy_accepted: true,
    })
    if (error) throw error
  }

  // Exactly what leaveParticipantEvent sends.
  async function leave(client: SupabaseClient<Database>, participantId: string) {
    const { data, error } = await client.rpc('leave_own_participant_entry', {
      p_participant_id: participantId,
    })
    if (error) throw error
    return data as unknown as LeaveResult
  }

  async function row(participantId: string) {
    const { data, error } = await serviceClient()
      .from('participants')
      .select('user_id, phone, privacy_accepted_at, avatar_url, name')
      .eq('id', participantId)
      .single()
    if (error) throw error
    return data
  }

  async function roles(userId: string) {
    const { data, error } = await serviceClient()
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
    if (error) throw error
    return data.map((r) => r.role)
  }

  async function canSeeEvent(client: SupabaseClient<Database>, eventId: string) {
    const { data, error } = await client.rpc('is_event_participant', { p_event_id: eventId })
    if (error) throw error
    return data
  }

  beforeAll(async () => {
    tenantId = (await createTenant('N74 Leave Tenant')).id
    eventA = await addEvent('N74 Event A')
    eventB = await addEvent('N74 Event B')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    for (const id of extraUsers) await deleteAuthUser(id)
  })

  it('leaves one of two events; the other still works and the role stays', async () => {
    const user = await runner()
    const inA = await addParticipant('Ella Berg', eventA)
    const inB = await addParticipant('Ella Berg', eventB)
    await claim(user.userId, inA, eventA)
    await claim(user.userId, inB, eventB)
    const avatarUrl = `http://127.0.0.1:54321/storage/v1/object/public/avatars/${tenantId}/participants/${inA}/1.webp`
    await serviceClient().from('participants').update({ avatar_url: avatarUrl }).eq('id', inA)
    const client = await signInAsClient(user.phone, '000000')

    const result = await leave(client, inA)

    // The exact keys the action reads — a replace migration must keep them.
    expect(result).toEqual({
      left: true,
      tenant_id: tenantId,
      event_id: eventA,
      avatar_url: avatarUrl,
    })

    // Same four columns as an admin unlink; the record itself stays.
    expect(await row(inA)).toEqual({
      user_id: null,
      phone: null,
      privacy_accepted_at: null,
      avatar_url: null,
      name: 'Ella Berg',
    })
    expect(await canSeeEvent(client, eventA)).toBe(false)

    // The other entry is untouched and still readable in the same session.
    expect((await row(inB)).user_id).toBe(user.userId)
    expect(await canSeeEvent(client, eventB)).toBe(true)
    expect(await roles(user.userId)).toEqual(['participant'])

    // Audit: the participant, not an admin, is the actor. No PII in detail.
    const { data: audit, error } = await serviceClient()
      .from('audit_events')
      .select('tenant_id, actor_user_id, actor_role, action, target_type, target_id, detail')
      .eq('target_id', inA)
    expect(error).toBeNull()
    expect(audit).toEqual([
      {
        tenant_id: tenantId,
        actor_user_id: user.userId,
        actor_role: 'participant',
        action: 'participant_left_event',
        target_type: 'participant',
        target_id: inA,
        detail: { event_id: eventA },
      },
    ])
  })

  it('drops the participant role when the last entry is left; the account stays', async () => {
    const user = await runner()
    const only = await addParticipant('Nils Ek', eventA)
    await claim(user.userId, only, eventA)
    const client = await signInAsClient(user.phone, '000000')

    expect((await leave(client, only)).left).toBe(true)
    expect(await roles(user.userId)).toEqual([])

    const { data: authUser } = await serviceClient().auth.admin.getUserById(user.userId)
    expect(authUser.user?.id).toBe(user.userId)
  })

  it("cannot leave someone else's entry", async () => {
    const owner = await runner()
    const intruder = await runner()
    const theirs = await addParticipant('Maja Lind', eventA)
    await claim(owner.userId, theirs, eventA)
    const ownerBefore = await row(theirs)
    const intruderClient = await signInAsClient(intruder.phone, '000000')

    expect(await leave(intruderClient, theirs)).toEqual({ left: false })
    expect(await row(theirs)).toEqual(ownerBefore)

    const { data: audit } = await serviceClient()
      .from('audit_events')
      .select('id')
      .eq('target_id', theirs)
    expect(audit).toEqual([])
  })

  it('reports an already-left entry as not left, and it can be claimed again', async () => {
    const first = await runner()
    const record = await addParticipant('Olle Sand', eventA)
    await claim(first.userId, record, eventA)
    const firstClient = await signInAsClient(first.phone, '000000')

    expect((await leave(firstClient, record)).left).toBe(true)
    expect(await leave(firstClient, record)).toEqual({ left: false })

    const second = await runner()
    await claim(second.userId, record, eventA)
    expect((await row(record)).user_id).toBe(second.userId)
  })

  it('is not callable anonymously', async () => {
    const anon = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)
    const record = await addParticipant('Anon Target', eventA)
    const { error } = await anon.rpc('leave_own_participant_entry', { p_participant_id: record })
    expect(error).not.toBeNull()
  })
})

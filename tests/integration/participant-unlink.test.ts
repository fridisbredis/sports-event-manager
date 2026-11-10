import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  cleanupTenant,
  createUserWithRole,
  createUserWithoutRole,
  deleteAuthUser,
  signInAsClient,
} from './helpers'
import { fetchClaimCounts } from '@/lib/participants/claim-status'

// N41 / PART-01: unlinking a claimed participant record (L7, L26), and the
// claim counts PART-01 and EVT-01 share (L21, L25).
//
// Against real Postgres because the property the card's done-when names —
// "Unlink removes access at once" — lives in SQL: the
// participants_sync_participant_role trigger and is_event_participant. The
// app only writes one UPDATE; this proves what that UPDATE sets off. The
// writes run as a tenant admin through RLS, the client unlinkParticipant uses.

describe('N41: unlink a claimed participant', () => {
  let tenantId: string
  let otherTenantId: string
  let eventId: string
  let adminClient: SupabaseClient<Database>
  let otherAdminClient: SupabaseClient<Database>
  const extraUsers: string[] = []

  async function addParticipant(name: string) {
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

  async function claim(userId: string, participantId: string) {
    const { error } = await serviceClient().rpc('complete_participant_claim', {
      p_user_id: userId,
      p_participant_id: participantId,
      p_tenant_id: tenantId,
      p_event_id: eventId,
      p_privacy_accepted: true,
    })
    if (error) throw error
  }

  // Exactly what unlinkParticipant sends.
  function unlink(client: SupabaseClient<Database>, participantId: string) {
    return client
      .from('participants')
      .update({ user_id: null, phone: null, privacy_accepted_at: null, avatar_url: null })
      .eq('id', participantId)
      .eq('tenant_id', tenantId)
      .eq('event_id', eventId)
      .not('user_id', 'is', null)
      .select('id')
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

  async function canSeeEvent(client: SupabaseClient<Database>) {
    const { data, error } = await client.rpc('is_event_participant', { p_event_id: eventId })
    if (error) throw error
    return data
  }

  beforeAll(async () => {
    tenantId = (await createTenant('N41 Unlink Tenant')).id
    otherTenantId = (await createTenant('N41 Other Tenant')).id

    const { data: event, error } = await serviceClient()
      .from('events')
      .insert({ tenant_id: tenantId, name: 'N41 Event', event_type: 'race' })
      .select('id')
      .single()
    if (error) throw error
    eventId = event.id

    const admin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(admin.phone, '000000')
    const otherAdmin = await createUserWithRole(otherTenantId, 'tenant_admin')
    otherAdminClient = await signInAsClient(otherAdmin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
    for (const id of extraUsers) await deleteAuthUser(id)
  })

  it('takes the access away at once and puts the record back to Unclaimed', async () => {
    const participantId = await addParticipant('Lisa Nord')
    const user = await runner()
    await claim(user.userId, participantId)
    const runnerClient = await signInAsClient(user.phone, '000000')

    expect(await roles(user.userId)).toEqual(['participant'])
    expect(await canSeeEvent(runnerClient)).toBe(true)

    const { data, error } = await unlink(adminClient, participantId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)

    // The same signed-in session, no new login: access is read per request.
    expect(await canSeeEvent(runnerClient)).toBe(false)
    expect(await roles(user.userId)).toEqual([])

    const { data: row } = await serviceClient()
      .from('participants')
      .select('user_id, phone, privacy_accepted_at, avatar_url')
      .eq('id', participantId)
      .single()
    expect(row).toEqual({ user_id: null, phone: null, privacy_accepted_at: null, avatar_url: null })

    // L26: the account itself is kept.
    const { data: authUser } = await serviceClient().auth.admin.getUserById(user.userId)
    expect(authUser.user?.id).toBe(user.userId)
  })

  it('lets the record be claimed again, by someone else', async () => {
    const participantId = await addParticipant('Karl Ström')
    const first = await runner()
    await claim(first.userId, participantId)
    await unlink(adminClient, participantId)

    const second = await runner()
    await claim(second.userId, participantId)

    const { data: row } = await serviceClient()
      .from('participants')
      .select('user_id, phone')
      .eq('id', participantId)
      .single()
    expect(row?.user_id).toBe(second.userId)
    expect(row?.phone).toBe(second.phone.replace(/^\+/, ''))
  })

  it('keeps the tier role of an account that is also an official', async () => {
    // Unlinking takes away the participant record, not someone's other job.
    const official = await createUserWithRole(tenantId, 'official')
    const participantId = await addParticipant('Official Runner')
    await claim(official.userId, participantId)

    await unlink(adminClient, participantId)

    expect(await roles(official.userId)).toEqual(['official'])
  })

  it('does nothing to an unclaimed row', async () => {
    const participantId = await addParticipant('Nobody Yet')
    await serviceClient()
      .from('participants')
      .update({ phone: '46700000001' })
      .eq('id', participantId)

    const { data, error } = await unlink(adminClient, participantId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)

    // The phone an admin typed in survives an unlink of nothing.
    const { data: row } = await serviceClient()
      .from('participants')
      .select('phone')
      .eq('id', participantId)
      .single()
    expect(row?.phone).toBe('46700000001')
  })

  it("does not let another tenant's admin unlink", async () => {
    const participantId = await addParticipant('Emma Sjö')
    const user = await runner()
    await claim(user.userId, participantId)

    const { data } = await unlink(otherAdminClient, participantId)
    expect(data ?? []).toHaveLength(0)
    expect(await roles(user.userId)).toEqual(['participant'])
  })

  it('lets a claimed participant who is no longer on the Race Results list still sign in', async () => {
    // L19: struck by the import (withdrawn_at), kept and labelled — and
    // their access is not the import's to take away.
    const participantId = await addParticipant('Ida Bergqvist')
    const user = await runner()
    await claim(user.userId, participantId)
    await serviceClient()
      .from('participants')
      .update({ withdrawn_at: new Date().toISOString() })
      .eq('id', participantId)

    const runnerClient = await signInAsClient(user.phone, '000000')
    expect(await canSeeEvent(runnerClient)).toBe(true)
    expect(await roles(user.userId)).toEqual(['participant'])
  })

  it('counts claimed records the same way for both screens, leaving struck rows out', async () => {
    // State built up by the tests above: Karl (claimed), Official Runner and
    // Lisa (unlinked), Nobody Yet, Emma (claimed), Ida (claimed, struck).
    const counts = await fetchClaimCounts(adminClient, { tenantId, eventId, op: 'test' })
    expect(counts).toEqual({ claimed: 2, total: 5, conflicts: 0 })
  })
})

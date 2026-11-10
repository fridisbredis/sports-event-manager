import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
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

// N42 / migration 20261110142443: claim conflicts (L6, L11, L18).
//
// Against real Postgres because everything the card's done-when names lives
// in SQL: submit_participant_claim deciding claim-or-conflict under the row
// lock, switch_participant_claimant moving the link, the trigger clearing
// pending claimants, and sync_participant_role moving the access. The admin
// calls run as a tenant admin through RLS — the client the actions use.

type Outcome = { participant_id: string; event_id: string; role_granted: boolean; outcome: string }

describe('N42: claim conflicts', () => {
  let tenantId: string
  let otherTenantId: string
  let eventId: string
  let adminClient: SupabaseClient<Database>
  let otherAdminClient: SupabaseClient<Database>
  const extraUsers: string[] = []

  async function addParticipant(name: string, event = eventId) {
    const { data, error } = await serviceClient()
      .from('participants')
      .insert({ tenant_id: tenantId, event_id: event, name })
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

  // Exactly what /api/claim/complete sends, through the service client.
  async function submit(userId: string, participantId: string) {
    return serviceClient().rpc('submit_participant_claim', {
      p_user_id: userId,
      p_participant_id: participantId,
      p_tenant_id: tenantId,
      p_event_id: eventId,
      p_privacy_accepted: true,
    })
  }

  async function submitOk(userId: string, participantId: string) {
    const { data, error } = await submit(userId, participantId)
    if (error) throw error
    return data as unknown as Outcome
  }

  async function pending(participantId: string) {
    const { data, error } = await serviceClient()
      .from('participant_claim_conflicts')
      .select('id, user_id, phone')
      .eq('participant_id', participantId)
      .order('created_at')
    if (error) throw error
    return data
  }

  async function holder(participantId: string) {
    const { data, error } = await serviceClient()
      .from('participants')
      .select('user_id, phone, privacy_accepted_at, avatar_url')
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

  async function canSeeEvent(client: SupabaseClient<Database>) {
    const { data, error } = await client.rpc('is_event_participant', { p_event_id: eventId })
    if (error) throw error
    return data
  }

  function switchTo(client: SupabaseClient<Database>, conflictId: string) {
    return client.rpc('switch_participant_claimant', {
      p_tenant_id: tenantId,
      p_event_id: eventId,
      p_conflict_id: conflictId,
    })
  }

  // Exactly what keepCurrentClaimant sends.
  function keepCurrent(client: SupabaseClient<Database>, participantId: string) {
    return client
      .from('participant_claim_conflicts')
      .delete()
      .eq('participant_id', participantId)
      .eq('tenant_id', tenantId)
      .eq('event_id', eventId)
      .select('id')
  }

  beforeAll(async () => {
    tenantId = (await createTenant('N42 Conflict Tenant')).id
    otherTenantId = (await createTenant('N42 Other Tenant')).id

    const { data: event, error } = await serviceClient()
      .from('events')
      .insert({ tenant_id: tenantId, name: 'N42 Event', event_type: 'race' })
      .select('id')
      .single()
    if (error) throw error
    eventId = event.id

    const admin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(admin.phone, '000000')
    const otherAdmin = await createUserWithRole(otherTenantId, 'tenant_admin')
    otherAdminClient = await signInAsClient(otherAdmin.phone, '000000')
  })

  // The local stack has ten test phone numbers, and a conflict needs at least
  // two runners. Each test frees its own; deleting a runner cascades its
  // pending conflicts, so every test starts from what it builds itself.
  afterEach(async () => {
    for (const id of extraUsers.splice(0)) await deleteAuthUser(id)
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
  })

  it('claims an unclaimed record as before, with outcome claimed', async () => {
    const participantId = await addParticipant('Karl Ström')
    const first = await runner()

    const result = await submitOk(first.userId, participantId)

    expect(result).toEqual({
      participant_id: participantId,
      event_id: eventId,
      role_granted: true,
      outcome: 'claimed',
    })
    expect((await holder(participantId)).user_id).toBe(first.userId)
    expect(await pending(participantId)).toEqual([])
  })

  it('stores a second claim as a conflict, with no access, and the first keeps theirs', async () => {
    const participantId = await addParticipant('Lisa Nord')
    const first = await runner()
    const second = await runner()
    await submitOk(first.userId, participantId)

    const result = await submitOk(second.userId, participantId)

    expect(result).toMatchObject({ outcome: 'conflict', role_granted: false })
    expect(await pending(participantId)).toEqual([
      {
        id: expect.any(String),
        user_id: second.userId,
        phone: second.phone.replace(/^\+/, ''),
      },
    ])
    // L6: the first claim still holds.
    expect((await holder(participantId)).user_id).toBe(first.userId)
    expect(await roles(second.userId)).toEqual([])
    const secondClient = await signInAsClient(second.phone, '000000')
    expect(await canSeeEvent(secondClient)).toBe(false)
  })

  it('is idempotent for the holder and for a claimant trying twice', async () => {
    const participantId = await addParticipant('Oskar Berg')
    const first = await runner()
    const second = await runner()
    await submitOk(first.userId, participantId)

    expect(await submitOk(first.userId, participantId)).toMatchObject({ outcome: 'claimed' })
    await submitOk(second.userId, participantId)
    await submitOk(second.userId, participantId)

    expect(await pending(participantId)).toHaveLength(1)
  })

  it('keeps every further claimant, each once (third claim while a conflict is open)', async () => {
    const participantId = await addParticipant('Emma Sjö')
    const first = await runner()
    const second = await runner()
    const third = await runner()
    await submitOk(first.userId, participantId)
    await submitOk(second.userId, participantId)
    await submitOk(third.userId, participantId)

    expect((await pending(participantId)).map((c) => c.user_id)).toEqual([
      second.userId,
      third.userId,
    ])
  })

  it('refuses a conflict from someone already linked to another record in the event', async () => {
    const participantId = await addParticipant('Nils Ahl')
    const ownRow = await addParticipant('Nils Ahl Jr')
    const first = await runner()
    const second = await runner()
    await submitOk(first.userId, participantId)
    await submitOk(second.userId, ownRow)

    const { error } = await submit(second.userId, participantId)

    expect(error?.message).toBe('already_in_event')
    expect(await pending(participantId)).toEqual([])
  })

  it('Switch to new: the old claimant loses access, the new one can sign in, the rest are dismissed', async () => {
    const participantId = await addParticipant('Ida Bergqvist')
    const first = await runner()
    const second = await runner()
    const third = await runner()
    await submitOk(first.userId, participantId)
    await serviceClient()
      .from('participants')
      .update({ avatar_url: 'https://x/storage/v1/object/public/avatars/old.webp' })
      .eq('id', participantId)
    await submitOk(second.userId, participantId)
    await submitOk(third.userId, participantId)
    const firstClient = await signInAsClient(first.phone, '000000')
    expect(await canSeeEvent(firstClient)).toBe(true)

    const target = (await pending(participantId)).find((c) => c.user_id === second.userId)!
    const { data, error } = await switchTo(adminClient, target.id)

    expect(error).toBeNull()
    // The shape switchToNewClaimant reads.
    expect(data).toEqual({
      participant_id: participantId,
      previous_avatar_url: 'https://x/storage/v1/object/public/avatars/old.webp',
    })
    const row = await holder(participantId)
    expect(row.user_id).toBe(second.userId)
    expect(row.phone).toBe(second.phone.replace(/^\+/, ''))
    expect(row.privacy_accepted_at).not.toBeNull()
    expect(row.avatar_url).toBeNull()

    // The same signed-in session loses access at once.
    expect(await canSeeEvent(firstClient)).toBe(false)
    expect(await roles(first.userId)).toEqual([])
    expect(await roles(second.userId)).toEqual(['participant'])
    const secondClient = await signInAsClient(second.phone, '000000')
    expect(await canSeeEvent(secondClient)).toBe(true)

    // The third claimant was waiting on the same record: dismissed.
    expect(await pending(participantId)).toEqual([])
  })

  it("Keep current: dismisses every pending claimant and changes nobody's access", async () => {
    const participantId = await addParticipant('Per Nord')
    const first = await runner()
    const second = await runner()
    await submitOk(first.userId, participantId)
    await submitOk(second.userId, participantId)

    const { data, error } = await keepCurrent(adminClient, participantId)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(await pending(participantId)).toEqual([])
    expect((await holder(participantId)).user_id).toBe(first.userId)
    expect(await roles(first.userId)).toEqual(['participant'])

    // A second press finds nothing: the action reports "not found".
    const again = await keepCurrent(adminClient, participantId)
    expect(again.data).toHaveLength(0)
  })

  it('Unlink clears pending claimants: the record is simply claimable again', async () => {
    const participantId = await addParticipant('Anna Lind')
    const first = await runner()
    const second = await runner()
    await submitOk(first.userId, participantId)
    await submitOk(second.userId, participantId)

    await adminClient
      .from('participants')
      .update({ user_id: null, phone: null, privacy_accepted_at: null, avatar_url: null })
      .eq('id', participantId)
      .not('user_id', 'is', null)

    expect(await pending(participantId)).toEqual([])
    expect(await submitOk(second.userId, participantId)).toMatchObject({ outcome: 'claimed' })
  })

  it("drops a claimant's pending conflicts once they claim another record in the event", async () => {
    const contested = await addParticipant('Maja Ek')
    const free = await addParticipant('Maja Ek (right one)')
    const first = await runner()
    const second = await runner()
    await submitOk(first.userId, contested)
    await submitOk(second.userId, contested)

    await submitOk(second.userId, free)

    expect(await pending(contested)).toEqual([])
  })

  it('hides conflicts from anyone but the tenant admin', async () => {
    const participantId = await addParticipant('Sara Holm')
    const first = await runner()
    const second = await runner()
    await submitOk(first.userId, participantId)
    await submitOk(second.userId, participantId)
    const conflictId = (await pending(participantId))[0].id

    // Another tenant's admin: sees nothing, can neither switch nor dismiss.
    const { data: seen } = await otherAdminClient
      .from('participant_claim_conflicts')
      .select('id')
      .eq('participant_id', participantId)
    expect(seen ?? []).toHaveLength(0)
    const { error: switchError } = await switchTo(otherAdminClient, conflictId)
    expect(switchError?.message).toBe('not_found')
    const { data: dismissed } = await keepCurrent(otherAdminClient, participantId)
    expect(dismissed ?? []).toHaveLength(0)

    // The current claimant (a participant in this tenant) sees nothing either.
    const firstClient = await signInAsClient(first.phone, '000000')
    const { data: own } = await firstClient.from('participant_claim_conflicts').select('id')
    expect(own ?? []).toHaveLength(0)
    const { error: ownSwitch } = await switchTo(firstClient, conflictId)
    expect(ownSwitch?.message).toBe('not_found')

    // An official in the tenant: nothing.
    const official = await runner()
    await serviceClient()
      .from('user_roles')
      .insert({ user_id: official.userId, tenant_id: tenantId, role: 'official' })
    const officialClient = await signInAsClient(official.phone, '000000')
    const { data: officialSeen } = await officialClient
      .from('participant_claim_conflicts')
      .select('id')
    expect(officialSeen ?? []).toHaveLength(0)

    expect(await pending(participantId)).toHaveLength(1)
  })

  it('does not let a signed-in user call submit_participant_claim directly', async () => {
    const participantId = await addParticipant('Direct Caller')
    const user = await runner()
    const client = await signInAsClient(user.phone, '000000')

    const { error } = await client.rpc('submit_participant_claim', {
      p_user_id: user.userId,
      p_participant_id: participantId,
      p_tenant_id: tenantId,
      p_event_id: eventId,
      p_privacy_accepted: true,
    })

    expect(error).not.toBeNull()
    expect((await holder(participantId)).user_id).toBeNull()
  })

  it('counts conflicts per record, not per claimant, leaving struck rows out', async () => {
    // Runners from earlier tests are gone (afterEach), and their conflicts
    // with them, so only what this test builds is open.
    const twoWaiting = await addParticipant('Two Waiting')
    const oneWaiting = await addParticipant('One Waiting')
    const [a, a2, a3, b, b2] = [
      await runner(),
      await runner(),
      await runner(),
      await runner(),
      await runner(),
    ]
    await submitOk(a.userId, twoWaiting)
    await submitOk(a2.userId, twoWaiting)
    await submitOk(a3.userId, twoWaiting)
    await submitOk(b.userId, oneWaiting)
    await submitOk(b2.userId, oneWaiting)

    const counts = await fetchClaimCounts(adminClient, { tenantId, eventId, op: 'test' })
    expect(counts?.conflicts).toBe(2)

    // Struck rows are left out, as for the claimed count.
    await serviceClient()
      .from('participants')
      .update({ withdrawn_at: new Date().toISOString() })
      .eq('id', oneWaiting)
    const after = await fetchClaimCounts(adminClient, { tenantId, eventId, op: 'test' })
    expect(after?.conflicts).toBe(1)
  })
})

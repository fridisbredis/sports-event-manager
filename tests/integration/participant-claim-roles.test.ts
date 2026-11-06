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

// N35 / migration 20261106120000: one account, several roles (L5, L26).
//
// Against real Postgres because every property here lives in SQL: the phone
// match and locking in claim_participant, the triggers that keep the
// participant tier in user_roles, the per-event uniqueness of a participant
// link and the participant read policy on events. A mocked client could only
// show what the app asks for.
describe('N35: one account, official and participant', () => {
  let tenantId: string
  let otherTenantId: string
  let eventA: string
  let eventB: string
  let otherTenantEvent: string
  let official: { userId: string; phone: string }
  let officialId: string
  let adminClient: SupabaseClient<Database>

  // '+46700000003' → '070-000 00 03': the national, hand-typed shape PART-01
  // stores, so the claim has to normalise to match auth.users.phone.
  const national = (phone: string) => {
    const d = phone.replace('+46', '0')
    return `${d.slice(0, 3)}-${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`
  }

  async function addParticipant(event: string, phone: string | null, tenant = tenantId) {
    const { data, error } = await serviceClient()
      .from('participants')
      .insert({ tenant_id: tenant, event_id: event, name: 'Runner', phone })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  async function claim(userId: string, participantId: string, tenant = tenantId) {
    return serviceClient().rpc('claim_participant', {
      p_user_id: userId,
      p_participant_id: participantId,
      p_tenant_id: tenant,
    })
  }

  async function rolesOf(userId: string, tenant = tenantId) {
    const { data, error } = await serviceClient()
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenant)
    if (error) throw error
    return data.map((r) => r.role)
  }

  async function linkedUser(participantId: string) {
    const { data, error } = await serviceClient()
      .from('participants')
      .select('user_id')
      .eq('id', participantId)
      .single()
    if (error) throw error
    return data.user_id
  }

  beforeAll(async () => {
    const admin = serviceClient()
    tenantId = (await createTenant('N35 Roles', 'premium')).id
    otherTenantId = (await createTenant('N35 Other')).id

    const { data: events, error } = await admin
      .from('events')
      .insert([
        { tenant_id: tenantId, name: 'A', event_type: 'race' },
        { tenant_id: tenantId, name: 'B', event_type: 'race' },
        { tenant_id: otherTenantId, name: 'X', event_type: 'race' },
      ])
      .select('id, name')
    if (error) throw error
    eventA = events.find((e) => e.name === 'A')!.id
    eventB = events.find((e) => e.name === 'B')!.id
    otherTenantEvent = events.find((e) => e.name === 'X')!.id

    // Two events exist, so the sole-event trigger adds no membership: the
    // official is put in event A only, by hand.
    official = await createUserWithRole(tenantId, 'official')
    const { data: row, error: rowError } = await admin
      .from('officials')
      .select('id')
      .eq('user_id', official.userId)
      .single()
    if (rowError) throw rowError
    officialId = row.id
    const { error: memberError } = await admin
      .from('official_events')
      .insert({ official_id: officialId, event_id: eventA, tenant_id: tenantId })
    if (memberError) throw memberError

    const { phone } = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
  })

  it('lets an official claim a participant record in their own event and keeps one role row', async () => {
    const usersBefore = (await serviceClient().auth.admin.listUsers({ perPage: 1000 })).data.users
      .length
    const participantId = await addParticipant(eventA, national(official.phone))

    const { data, error } = await claim(official.userId, participantId)
    expect(error).toBeNull()
    // Exact keys: N40's claim UI will destructure this jsonb, and gen types
    // cannot see inside it.
    expect(data).toEqual({ participant_id: participantId, event_id: eventA, role_granted: false })

    expect(await linkedUser(participantId)).toBe(official.userId)
    // Still exactly one tenant tier row — the higher one — and no new user.
    expect(await rolesOf(official.userId)).toEqual(['official'])
    const usersAfter = (await serviceClient().auth.admin.listUsers({ perPage: 1000 })).data.users
      .length
    expect(usersAfter).toBe(usersBefore)
  })

  it('is idempotent for the same user', async () => {
    const participantId = await addParticipant(eventB, official.phone)
    expect((await claim(official.userId, participantId)).error).toBeNull()
    const again = await claim(official.userId, participantId)
    expect(again.error).toBeNull()
    expect(again.data).toEqual({
      participant_id: participantId,
      event_id: eventB,
      role_granted: false,
    })
  })

  it('links one user to participant rows in two events (per-event, not global, uniqueness)', async () => {
    const { count, error } = await serviceClient()
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', official.userId)
    expect(error).toBeNull()
    expect(count).toBe(2)
  })

  it('refuses a second participant row in the same event for the same user', async () => {
    const participantId = await addParticipant(eventA, official.phone)
    const { error } = await claim(official.userId, participantId)
    expect(error?.message).toBe('already_in_event')
    expect(await linkedUser(participantId)).toBeNull()
  })

  it('refuses a record whose phone does not match, or has none', async () => {
    const other = await addParticipant(eventA, '070-999 99 99')
    const none = await addParticipant(eventA, null)
    expect((await claim(official.userId, other)).error?.message).toBe('phone_mismatch')
    expect((await claim(official.userId, none)).error?.message).toBe('phone_mismatch')
    expect(await linkedUser(other)).toBeNull()
  })

  it('refuses a record in another tenant', async () => {
    const foreign = await addParticipant(otherTenantEvent, official.phone, otherTenantId)
    // Asked as if it were this tenant's: not found, not linked.
    expect((await claim(official.userId, foreign)).error?.message).toBe('not_found')
    expect(await linkedUser(foreign)).toBeNull()
  })

  it('refuses a record someone else already claimed', async () => {
    const someone = await createUserWithRole(tenantId, 'tenant_admin')
    const participantId = await addParticipant(eventB, someone.phone)
    expect((await claim(someone.userId, participantId)).error).toBeNull()
    expect((await claim(official.userId, participantId)).error?.message).toBe('already_claimed')
  })

  it('grants the participant tier to a user with no role in the tenant', async () => {
    // A runner in this tenant only through another tenant's account history:
    // created as an admin elsewhere, so they have no row here.
    const runner = await createUserWithRole(otherTenantId, 'tenant_admin')
    const participantId = await addParticipant(eventB, runner.phone)

    const { data, error } = await claim(runner.userId, participantId)
    expect(error).toBeNull()
    expect(data).toEqual({ participant_id: participantId, event_id: eventB, role_granted: true })
    expect(await rolesOf(runner.userId)).toEqual(['participant'])
    // The other tenant's row is untouched.
    expect(await rolesOf(runner.userId, otherTenantId)).toEqual(['tenant_admin'])

    // L26: removing the last membership drops the role, keeps the account.
    const { error: deleteError } = await adminClient
      .from('participants')
      .delete()
      .eq('id', participantId)
    expect(deleteError).toBeNull()
    expect(await rolesOf(runner.userId)).toEqual([])
    const { data: user } = await serviceClient().auth.admin.getUserById(runner.userId)
    expect(user.user?.id).toBe(runner.userId)
  })

  it('removing the participant link of an official leaves the official role intact', async () => {
    const participantId = await addParticipant(eventA, official.phone)
    // The user already holds A's other row from the first test; free it first
    // so this one can be claimed.
    await serviceClient()
      .from('participants')
      .update({ user_id: null })
      .eq('user_id', official.userId)
      .eq('event_id', eventA)
    expect((await claim(official.userId, participantId)).error).toBeNull()

    const { error } = await adminClient
      .from('participants')
      .update({ user_id: null })
      .eq('id', participantId)
    expect(error).toBeNull()
    expect(await rolesOf(official.userId)).toEqual(['official'])
  })

  describe('reads, as the signed-in user with both roles', () => {
    let client: SupabaseClient<Database>

    beforeAll(async () => {
      // Official in A (membership), participant in B (claimed above).
      client = await signInAsClient(official.phone, '000000')
    })

    it('reads both events: A as an official, B as a participant', async () => {
      const { data, error } = await client.from('events').select('id').eq('tenant_id', tenantId)
      expect(error).toBeNull()
      expect(data!.map((e) => e.id).sort()).toEqual([eventA, eventB].sort())
    })

    it('reads work areas only in the event they are an official in', async () => {
      const admin = serviceClient()
      const { error } = await admin.from('workstations').insert([
        { tenant_id: tenantId, event_id: eventA, name: 'Desk A', capacity_ceiling: 1 },
        { tenant_id: tenantId, event_id: eventB, name: 'Desk B', capacity_ceiling: 1 },
      ])
      expect(error).toBeNull()

      const { data } = await client.from('workstations').select('name').eq('tenant_id', tenantId)
      expect(data!.map((w) => w.name)).toEqual(['Desk A'])
    })

    it('reads its own participant rows only', async () => {
      const { data } = await client.from('participants').select('event_id, user_id')
      expect(data!.length).toBeGreaterThan(0)
      expect(data!.every((p) => p.user_id === official.userId)).toBe(true)
    })

    it('cannot call claim_participant from its own session', async () => {
      const { error } = await client.rpc('claim_participant', {
        p_user_id: official.userId,
        p_participant_id: officialId,
        p_tenant_id: tenantId,
      })
      expect(error?.code).toBe('42501')
    })
  })

  it('removing the official role of a participant leaves the participant role', async () => {
    // Last event → remove_official, which deletes the 'official' row; the
    // user is still linked to B's participant record.
    const { data, error } = await adminClient.rpc('remove_official_from_event', {
      p_official_id: officialId,
      p_event_id: eventA,
      p_tenant_id: tenantId,
    })
    expect(error).toBeNull()
    expect(data).toEqual({ removed_from_tenant: true, user_id: official.userId })
    expect(await rolesOf(official.userId)).toEqual(['participant'])

    const { count } = await serviceClient()
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', official.userId)
      .eq('event_id', eventB)
    expect(count).toBe(1)
  })
})

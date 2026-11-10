import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import {
  serviceClient,
  createTenant,
  cleanupTenant,
  createUserWithRole,
  createUserWithoutRole,
  deleteAuthUser,
  signInAsClient,
} from './helpers'

// N40 / migration 20261110130000: complete_participant_claim, the RPC behind
// CLAIM-02's Complete button.
//
// Against real Postgres because the properties are SQL ones: the claim and
// the consent timestamp commit together or not at all, the event boundary is
// checked inside the transaction, and the jsonb keys the route destructures
// are invisible to gen types (F-REL-16). The last block covers the card's
// done-criterion that a Race Results re-import never undoes a claim — the
// import upserts on external_id, so the claim must survive a changed bib.
describe('N40: complete_participant_claim', () => {
  let tenantId: string
  let eventA: string
  let eventB: string
  let stageA: string
  let adminClient: SupabaseClient<Database>
  const extraUsers: string[] = []

  async function addParticipant(
    event: string,
    fields: Partial<Database['public']['Tables']['participants']['Insert']> = {}
  ) {
    const { data, error } = await serviceClient()
      .from('participants')
      .insert({ tenant_id: tenantId, event_id: event, name: 'Runner', ...fields })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  async function complete(
    userId: string,
    participantId: string,
    opts: { event?: string; privacy?: boolean } = {}
  ) {
    return serviceClient().rpc('complete_participant_claim', {
      p_user_id: userId,
      p_participant_id: participantId,
      p_tenant_id: tenantId,
      p_event_id: opts.event ?? eventA,
      p_privacy_accepted: opts.privacy ?? true,
    })
  }

  async function row(participantId: string) {
    const { data, error } = await serviceClient()
      .from('participants')
      .select('user_id, privacy_accepted_at, bib, avatar_url')
      .eq('id', participantId)
      .single()
    if (error) throw error
    return data
  }

  async function newUser() {
    const user = await createUserWithoutRole()
    extraUsers.push(user.userId)
    return user
  }

  beforeAll(async () => {
    const admin = serviceClient()
    tenantId = (await createTenant('N40 Claim', 'premium')).id

    const { data: events, error } = await admin
      .from('events')
      .insert([
        { tenant_id: tenantId, name: 'A', event_type: 'race' },
        { tenant_id: tenantId, name: 'B', event_type: 'race' },
      ])
      .select('id, name')
    if (error) throw error
    eventA = events.find((e) => e.name === 'A')!.id
    eventB = events.find((e) => e.name === 'B')!.id

    const { data: stage, error: stageError } = await admin
      .from('event_stages')
      .insert({ event_id: eventA, tenant_id: tenantId, name: 'Race', stage_type: 'race' })
      .select('id')
      .single()
    if (stageError) throw stageError
    stageA = stage.id

    const { phone } = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(phone, '000000')
  })

  // The suite has ten test phone numbers, so each test frees its users
  // rather than holding them until the end.
  afterEach(async () => {
    while (extraUsers.length) await deleteAuthUser(extraUsers.pop()!)
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  it('links, records consent and returns exactly the keys the route reads', async () => {
    const user = await newUser()
    const participantId = await addParticipant(eventA)

    const { data, error } = await complete(user.userId, participantId)

    expect(error).toBeNull()
    expect(data).toEqual({ participant_id: participantId, event_id: eventA, role_granted: true })
    const after = await row(participantId)
    expect(after.user_id).toBe(user.userId)
    expect(after.privacy_accepted_at).not.toBeNull()
  })

  it('refuses without consent and leaves the row unclaimed', async () => {
    const user = await newUser()
    const participantId = await addParticipant(eventA)

    const { error } = await complete(user.userId, participantId, { privacy: false })

    expect(error?.message).toBe('privacy_not_accepted')
    expect(await row(participantId)).toMatchObject({ user_id: null, privacy_accepted_at: null })
  })

  it("refuses a participant from another event than the token's", async () => {
    // The token resolves to event A; the body names a row in event B of the
    // same tenant. claim_participant alone would accept it (tenant matches).
    const user = await newUser()
    const inB = await addParticipant(eventB)

    const { error } = await complete(user.userId, inB, { event: eventA })

    expect(error?.message).toBe('not_found')
    expect((await row(inB)).user_id).toBeNull()
  })

  it.each([
    ['withdrawn', { withdrawn_at: new Date().toISOString() }],
    ['hidden', { hidden_at: new Date().toISOString() }],
  ])('refuses a %s participant like an unknown one', async (_label, fields) => {
    const user = await newUser()
    const participantId = await addParticipant(eventA, fields)

    const { error } = await complete(user.userId, participantId)

    expect(error?.message).toBe('not_found')
  })

  it('first claim wins (L6)', async () => {
    const first = await newUser()
    const second = await newUser()
    const participantId = await addParticipant(eventA)

    expect((await complete(first.userId, participantId)).error).toBeNull()
    const { error } = await complete(second.userId, participantId)

    expect(error?.message).toBe('already_claimed')
    expect((await row(participantId)).user_id).toBe(first.userId)
  })

  it('blocks a second participant for the same number in one event (L13)', async () => {
    const user = await newUser()
    const one = await addParticipant(eventA)
    const two = await addParticipant(eventA)

    expect((await complete(user.userId, one)).error).toBeNull()
    const { error } = await complete(user.userId, two)

    expect(error?.message).toBe('already_in_event')
    expect((await row(two)).user_id).toBeNull()
  })

  it('is idempotent for the same user and keeps the first consent time', async () => {
    const user = await newUser()
    const participantId = await addParticipant(eventA)

    await complete(user.userId, participantId)
    const firstConsent = (await row(participantId)).privacy_accepted_at
    const { data, error } = await complete(user.userId, participantId)

    expect(error).toBeNull()
    expect(data).toEqual({ participant_id: participantId, event_id: eventA, role_granted: false })
    expect((await row(participantId)).privacy_accepted_at).toBe(firstConsent)
  })

  it('is not callable by anon or authenticated users', async () => {
    const user = await newUser()
    const participantId = await addParticipant(eventA)

    const { error } = await adminClient.rpc('complete_participant_claim', {
      p_user_id: user.userId,
      p_participant_id: participantId,
      p_tenant_id: tenantId,
      p_event_id: eventA,
      p_privacy_accepted: true,
    })

    expect(error).not.toBeNull()
    expect((await row(participantId)).user_id).toBeNull()
  })

  describe('Race Results re-import after a claim', () => {
    async function importRows(rows: Record<string, string>[]) {
      const { error } = await adminClient.rpc('import_participants', {
        p_tenant_id: tenantId,
        p_stage_id: stageA,
        p_rows: rows as unknown as Json,
      })
      if (error) throw error
    }

    it('keeps the claim, consent and photo when the bib changes', async () => {
      await importRows([{ external_id: 'rr-777', name: 'Lisa Nord', bib: '101' }])
      const { data: imported, error } = await serviceClient()
        .from('participants')
        .select('id')
        .eq('event_id', eventA)
        .eq('external_id', 'rr-777')
        .single()
      if (error) throw error

      const user = await newUser()
      expect((await complete(user.userId, imported.id)).error).toBeNull()
      await serviceClient()
        .from('participants')
        .update({ avatar_url: 'https://example.test/photo.webp' })
        .eq('id', imported.id)
      const claimed = await row(imported.id)

      // Same Race Results id, new bib.
      await importRows([{ external_id: 'rr-777', name: 'Lisa Nord', bib: '202' }])

      expect(await row(imported.id)).toEqual({
        ...claimed,
        bib: '202',
      })
    })
  })
})

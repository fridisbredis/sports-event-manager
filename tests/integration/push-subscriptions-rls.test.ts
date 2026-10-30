import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { serviceClient, createUserWithoutRole, signInAsClient, deleteAuthUser } from './helpers'

// N31: push_subscriptions is user-scoped (migration 20261029134922) and
// /api/account/push-subscription writes it on the RLS client, so the policies
// ARE the ownership check. The route's unit tests mock Supabase and cannot
// prove the database refuses anything; this does.
//
// The case that matters most is the shared device: a second user must not be
// able to read, take over or delete the first user's subscription, because
// that row decides whose announcements a phone receives.

const ENDPOINT_A = 'https://push.example/integration-user-a'

describe('push_subscriptions RLS (N31)', () => {
  let userA: string
  let userB: string
  let clientA: SupabaseClient<Database>
  let clientB: SupabaseClient<Database>

  beforeAll(async () => {
    const a = await createUserWithoutRole()
    const b = await createUserWithoutRole()
    userA = a.userId
    userB = b.userId
    clientA = await signInAsClient(a.phone, '000000')
    clientB = await signInAsClient(b.phone, '000000')
  })

  afterAll(async () => {
    // on delete cascade removes the subscription rows with the users.
    await deleteAuthUser(userA)
    await deleteAuthUser(userB)
  })

  it('lets a user register and read their own device', async () => {
    const { error } = await clientA
      .from('push_subscriptions')
      .upsert(
        { user_id: userA, endpoint: ENDPOINT_A, p256dh: 'p', auth: 'a' },
        { onConflict: 'endpoint' }
      )
    expect(error).toBeNull()

    const { data } = await clientA.from('push_subscriptions').select('endpoint')
    expect(data).toEqual([{ endpoint: ENDPOINT_A }])
  })

  it("hides another user's devices", async () => {
    const { data, error } = await clientB.from('push_subscriptions').select('endpoint')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('refuses a row written in someone else’s name', async () => {
    const { error } = await clientB
      .from('push_subscriptions')
      .insert({ user_id: userA, endpoint: 'https://push.example/forged', p256dh: 'p', auth: 'a' })
    expect(error?.code).toBe('42501')
  })

  // Shared device: B re-registers the endpoint A still holds. RLS hides A's
  // row, so the upsert cannot claim it — it must fail rather than silently
  // re-route A's announcements, and A's row must be untouched.
  it("cannot take over another user's endpoint", async () => {
    const { error } = await clientB
      .from('push_subscriptions')
      .upsert(
        { user_id: userB, endpoint: ENDPOINT_A, p256dh: 'p2', auth: 'a2' },
        { onConflict: 'endpoint' }
      )
    expect(error).not.toBeNull()

    const { data } = await serviceClient()
      .from('push_subscriptions')
      .select('user_id, p256dh')
      .eq('endpoint', ENDPOINT_A)
      .single()
    expect(data).toEqual({ user_id: userA, p256dh: 'p' })
  })

  it("cannot delete another user's device", async () => {
    await clientB.from('push_subscriptions').delete().eq('endpoint', ENDPOINT_A)

    const { count } = await serviceClient()
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('endpoint', ENDPOINT_A)
    expect(count).toBe(1)
  })

  it('lets a user remove their own device', async () => {
    const { error } = await clientA.from('push_subscriptions').delete().eq('endpoint', ENDPOINT_A)
    expect(error).toBeNull()

    const { count } = await serviceClient()
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('endpoint', ENDPOINT_A)
    expect(count).toBe(0)
  })
})

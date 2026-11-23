import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  signInAsClient,
  cleanupTenant,
} from './helpers'

// admin_guide_dismissals is user-scoped (migration 20261123120310) and
// /api/account/onboarding-guide writes it on the RLS client, so the policies
// ARE the ownership check. The route's unit tests mock Supabase and cannot
// prove the database refuses anything; this does.
//
// Two admins in the same tenant is the realistic case: one hiding the guide
// must not hide it for the other, nor be able to reopen it for them.

describe('admin_guide_dismissals RLS', () => {
  let tenantId: string
  let eventId: string
  let userA: string
  let userB: string
  let clientA: SupabaseClient<Database>
  let clientB: SupabaseClient<Database>

  beforeAll(async () => {
    const tenant = await createTenant('Guide Dismissals')
    tenantId = tenant.id
    const { data: event, error } = await serviceClient()
      .from('events')
      .insert({ tenant_id: tenantId, name: 'Guide event', event_type: 'race' })
      .select('id')
      .single()
    if (error) throw error
    eventId = event.id

    const a = await createUserWithRole(tenantId, 'tenant_admin')
    const b = await createUserWithRole(tenantId, 'tenant_admin')
    userA = a.userId
    userB = b.userId
    clientA = await signInAsClient(a.phone, '000000')
    clientB = await signInAsClient(b.phone, '000000')
  })

  afterAll(async () => {
    // cleanupTenant deletes the users and the event; both cascade to the rows.
    await cleanupTenant(tenantId)
  })

  it('lets a user hide the guide and read their own choice', async () => {
    const { error } = await clientA
      .from('admin_guide_dismissals')
      .upsert(
        { user_id: userA, event_id: eventId },
        { onConflict: 'user_id,event_id', ignoreDuplicates: true }
      )
    expect(error).toBeNull()

    const { data } = await clientA.from('admin_guide_dismissals').select('user_id, event_id')
    expect(data).toEqual([{ user_id: userA, event_id: eventId }])
  })

  it('treats hiding an already hidden guide as a no-op', async () => {
    const { error } = await clientA
      .from('admin_guide_dismissals')
      .upsert(
        { user_id: userA, event_id: eventId },
        { onConflict: 'user_id,event_id', ignoreDuplicates: true }
      )
    expect(error).toBeNull()
  })

  it("hides another admin's choice from them", async () => {
    const { data } = await clientB.from('admin_guide_dismissals').select('user_id')
    expect(data).toEqual([])
  })

  it('refuses to hide the guide on behalf of another user', async () => {
    const { error } = await clientB
      .from('admin_guide_dismissals')
      .insert({ user_id: userA, event_id: eventId })
    expect(error).not.toBeNull()
  })

  it("cannot reopen another user's guide", async () => {
    await clientB.from('admin_guide_dismissals').delete().eq('user_id', userA)

    const { data } = await serviceClient()
      .from('admin_guide_dismissals')
      .select('user_id')
      .eq('user_id', userA)
    expect(data).toHaveLength(1)
  })

  it('lets a user reopen their own guide', async () => {
    const { error } = await clientA
      .from('admin_guide_dismissals')
      .delete()
      .eq('user_id', userA)
      .eq('event_id', eventId)
    expect(error).toBeNull()

    const { data } = await clientA.from('admin_guide_dismissals').select('user_id')
    expect(data).toEqual([])
  })

  it('leaves user B able to hide their own guide independently', async () => {
    const { error } = await clientB
      .from('admin_guide_dismissals')
      .insert({ user_id: userB, event_id: eventId })
    expect(error).toBeNull()
  })
})

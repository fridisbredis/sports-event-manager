import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveRequestEventId } from '@/lib/events/request-event'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// N23 (migration 20261028141228): OFF-01's invite writes the official and
// their membership in the event the URL names, in one transaction.
describe('N23: create_official_in_event', () => {
  let tenantId: string
  let otherTenantId: string
  let event2026: string
  let event2027: string
  let foreignEvent: string
  let admin: SupabaseClient<Database>

  async function insertEvent(tid: string, name: string, status = 'draft') {
    const { data, error } = await serviceClient()
      .from('events')
      .insert({ tenant_id: tid, name, event_type: 'race', status })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  function invite(eventId: string, phone: string) {
    return admin.rpc('create_official_in_event', {
      p_tenant_id: tenantId,
      p_event_id: eventId,
      p_user_id: null as unknown as string,
      p_name: 'Anna',
      p_phone: phone,
      p_invite_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
  }

  async function officialsWithPhone(phone: string) {
    const { data } = await serviceClient()
      .from('officials')
      .select('id, official_events(event_id)')
      .eq('tenant_id', tenantId)
      .eq('phone', phone)
    return data ?? []
  }

  beforeAll(async () => {
    tenantId = (await createTenant('Invite Into Event')).id
    otherTenantId = (await createTenant('Invite Other')).id
    event2026 = await insertEvent(tenantId, 'Viadal 2026')
    event2027 = await insertEvent(tenantId, 'Viadal 2027')
    foreignEvent = await insertEvent(otherTenantId, 'Foreign')
    const user = await createUserWithRole(tenantId, 'tenant_admin')
    admin = await signInAsClient(user.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
  })

  it('creates the official as a member of the named event only, returning the row', async () => {
    const { data, error } = await invite(event2027, '+46704200001')
    expect(error).toBeNull()

    const row = data as Record<string, unknown>
    // The route reads id and invite_token, and returns the rest to OFF-01.
    expect(row).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        invite_token: expect.any(String),
        tenant_id: tenantId,
        name: 'Anna',
        phone: '+46704200001',
        invite_status: 'invited',
      })
    )

    const [official] = await officialsWithPhone('+46704200001')
    expect(official.official_events).toEqual([{ event_id: event2027 }])
  })

  it("writes nothing when the event is another tenant's", async () => {
    const { error } = await invite(foreignEvent, '+46704200002')
    expect(error?.code).toBe('23503')
    // The official insert ran first; the transaction must take it back.
    expect(await officialsWithPhone('+46704200002')).toEqual([])
  })

  it('keeps the duplicate-phone error the route maps to 409', async () => {
    const { error } = await invite(event2026, '+46704200001')
    expect(error?.code).toBe('23505')
  })
})

describe('N23: resolveRequestEventId', () => {
  let soleTenant: string
  let twoTenant: string
  let soleEvent: string
  let twoEvent: string

  beforeAll(async () => {
    soleTenant = (await createTenant('Resolve Sole')).id
    twoTenant = (await createTenant('Resolve Two')).id
    const admin = serviceClient()
    const insert = async (tid: string, name: string, status = 'draft') => {
      const { data, error } = await admin
        .from('events')
        .insert({ tenant_id: tid, name, event_type: 'race', status })
        .select('id')
        .single()
      if (error) throw error
      return data.id
    }
    soleEvent = await insert(soleTenant, 'Active')
    await insert(soleTenant, 'Old', 'archived')
    twoEvent = await insert(twoTenant, 'A')
    await insert(twoTenant, 'B')
  })

  afterAll(async () => {
    await cleanupTenant(soleTenant)
    await cleanupTenant(twoTenant)
  })

  it("falls back to the tenant's only non-archived event", async () => {
    expect(await resolveRequestEventId(serviceClient(), soleTenant, undefined)).toBe(soleEvent)
  })

  it('refuses to guess between several active events', async () => {
    expect(await resolveRequestEventId(serviceClient(), twoTenant, undefined)).toBeNull()
  })

  it("accepts a named event of the tenant and refuses another tenant's", async () => {
    expect(await resolveRequestEventId(serviceClient(), twoTenant, twoEvent)).toBe(twoEvent)
    expect(await resolveRequestEventId(serviceClient(), soleTenant, twoEvent)).toBeNull()
  })
})

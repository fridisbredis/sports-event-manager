import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  cleanupTenant,
  createUserWithRole,
  createParticipantLinkedToUser,
  signInAsClient,
} from './helpers'

// N38 (migration 20261109180943): who may write info sections, the L23
// content rule as a CHECK, and the atomic reorder RPC. Read isolation
// between events is covered with the other event-scoped tables in
// event-member-read.test.ts.
describe('N38: event_info_sections writes', () => {
  let tenantId: string
  let eventId: string
  let otherTenantEventId: string
  let otherTenantId: string
  let adminClient: SupabaseClient<Database>
  let officialClient: SupabaseClient<Database>
  let participantClient: SupabaseClient<Database>

  beforeAll(async () => {
    const service = serviceClient()
    tenantId = (await createTenant('Info Sections RLS')).id
    otherTenantId = (await createTenant('Info Sections RLS Other')).id

    const { data: event, error } = await service
      .from('events')
      .insert({ tenant_id: tenantId, name: 'Info Event', event_type: 'race', status: 'published' })
      .select('id')
      .single()
    if (error) throw error
    eventId = event.id

    const { data: other, error: otherError } = await service
      .from('events')
      .insert({ tenant_id: otherTenantId, name: 'Other', event_type: 'race' })
      .select('id')
      .single()
    if (otherError) throw otherError
    otherTenantEventId = other.id

    const tenantAdmin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(tenantAdmin.phone, '000000')
    const official = await createUserWithRole(tenantId, 'official')
    officialClient = await signInAsClient(official.phone, '000000')
    const participant = await createUserWithRole(tenantId, 'participant')
    await createParticipantLinkedToUser(tenantId, eventId, participant.userId, 'Runner')
    participantClient = await signInAsClient(participant.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
  })

  const section = (
    overrides: Partial<Database['public']['Tables']['event_info_sections']['Insert']> = {}
  ) => ({
    tenant_id: tenantId,
    event_id: eventId,
    title: 'Parking',
    body: 'North lot',
    ...overrides,
  })

  it('lets the tenant admin add a section', async () => {
    const { error } = await adminClient.from('event_info_sections').insert(section())
    expect(error).toBeNull()
  })

  it('refuses an official and a participant', async () => {
    for (const client of [officialClient, participantClient]) {
      const { error } = await client.from('event_info_sections').insert(section({ title: 'Nope' }))
      expect(error?.code).toBe('42501')
    }
  })

  // Participants read through the cached RPC (N43), gated on published in
  // the app — there is deliberately no participant read policy.
  it('gives a participant no direct read', async () => {
    const { data, error } = await participantClient
      .from('event_info_sections')
      .select('id')
      .eq('event_id', eventId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("refuses the admin a section in another tenant's event", async () => {
    const { error } = await adminClient
      .from('event_info_sections')
      .insert(section({ tenant_id: otherTenantId, event_id: otherTenantEventId }))
    expect(error?.code).toBe('42501')
  })

  // L23: a title plus at least one of text, image, link.
  it('rejects a section with only a title, or a blank one', async () => {
    const empty = await adminClient
      .from('event_info_sections')
      .insert(section({ title: 'Empty', body: null }))
    expect(empty.error?.code).toBe('23514')

    const blank = await adminClient
      .from('event_info_sections')
      .insert(section({ title: 'Blank', body: '   ' }))
    expect(blank.error?.code).toBe('23514')
  })

  it('accepts a link-only section and rejects a non-http link', async () => {
    const ok = await adminClient
      .from('event_info_sections')
      .insert(section({ title: 'Live video', body: null, link_url: 'https://video.example.com' }))
    expect(ok.error).toBeNull()

    const bad = await adminClient
      .from('event_info_sections')
      .insert(section({ title: 'Bad', body: null, link_url: 'javascript:alert(1)' }))
    expect(bad.error?.code).toBe('23514')
  })

  it('reorders all sections in one call and refuses an incomplete list', async () => {
    const { data: before } = await adminClient
      .from('event_info_sections')
      .select('id, title')
      .eq('event_id', eventId)
      .order('position')
    const reversed = before!.map((s) => s.id).reverse()

    const { error } = await adminClient.rpc('reorder_event_info_sections', {
      p_tenant_id: tenantId,
      p_event_id: eventId,
      p_ids: reversed,
    })
    expect(error).toBeNull()

    const { data: after } = await adminClient
      .from('event_info_sections')
      .select('id, position')
      .eq('event_id', eventId)
      .order('position')
    expect(after!.map((s) => s.id)).toEqual(reversed)
    expect(after!.map((s) => s.position)).toEqual(reversed.map((_, i) => i))

    const partial = await adminClient.rpc('reorder_event_info_sections', {
      p_tenant_id: tenantId,
      p_event_id: eventId,
      p_ids: reversed.slice(1),
    })
    expect(partial.error?.code).toBe('22023')
  })

  // SECURITY INVOKER: an official sees none of the rows to update, so the
  // count check fails rather than silently doing nothing.
  it('refuses the reorder RPC to an official', async () => {
    const { data } = await serviceClient()
      .from('event_info_sections')
      .select('id')
      .eq('event_id', eventId)
    const { error } = await officialClient.rpc('reorder_event_info_sections', {
      p_tenant_id: tenantId,
      p_event_id: eventId,
      p_ids: data!.map((s) => s.id),
    })
    expect(error).not.toBeNull()
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { serviceClient, createTenant, cleanupTenant } from './helpers'
import { loadClaimList } from '@/lib/participants/claim-list'

// N39 (CLAIM-01): the open claim list is public and runs with the service
// role, so loadClaimList is the whole boundary. Card, DONE WHEN: "the page
// cannot be used to list another event's participants (test it)". Run
// against real Postgres so the token lookup, the events.claim_token default
// and the participant filters are the real ones (migration 20261110120000).

async function createEvent(tenantId: string, name: string, status: 'draft' | 'published') {
  const { data, error } = await serviceClient()
    .from('events')
    .insert({ tenant_id: tenantId, name, event_type: 'race', status })
    .select('id, claim_token')
    .single()
  if (error) throw error
  return data
}

async function addParticipants(
  tenantId: string,
  eventId: string,
  rows: Array<{ bib: string; name: string; withdrawn?: boolean; hidden?: boolean }>
) {
  const now = new Date().toISOString()
  const { error } = await serviceClient()
    .from('participants')
    .insert(
      rows.map((r) => ({
        tenant_id: tenantId,
        event_id: eventId,
        bib: r.bib,
        name: r.name,
        phone: `4670${Math.floor(Math.random() * 10_000_000)}`,
        withdrawn_at: r.withdrawn ? now : null,
        hidden_at: r.hidden ? now : null,
      }))
    )
  if (error) throw error
}

describe('N39: claim list scoping', () => {
  let premium: string
  let otherTenant: string
  let standard: string
  let openEvent: { id: string; claim_token: string }
  let siblingEvent: { id: string; claim_token: string }
  let otherTenantEvent: { id: string; claim_token: string }
  let draftEvent: { id: string; claim_token: string }
  let standardEvent: { id: string; claim_token: string }

  beforeAll(async () => {
    premium = (await createTenant('N39 Premium', 'premium')).id
    otherTenant = (await createTenant('N39 Other', 'professional')).id
    standard = (await createTenant('N39 Standard', 'standard')).id

    openEvent = await createEvent(premium, 'Open event', 'published')
    siblingEvent = await createEvent(premium, 'Sibling event', 'published')
    draftEvent = await createEvent(premium, 'Draft event', 'draft')
    otherTenantEvent = await createEvent(otherTenant, 'Other tenant event', 'published')
    // Stored as published, as after a downgrade: still closed (N36).
    standardEvent = await createEvent(standard, 'Standard event', 'published')

    await addParticipants(premium, openEvent.id, [
      { bib: '101', name: 'Lisa Nord' },
      { bib: '102', name: 'Karl Ström' },
      { bib: '103', name: 'Struck Runner', withdrawn: true },
      { bib: '104', name: 'Hidden Runner', hidden: true },
    ])
    await addParticipants(premium, siblingEvent.id, [{ bib: '201', name: 'Sibling Runner' }])
    await addParticipants(premium, draftEvent.id, [{ bib: '301', name: 'Draft Runner' }])
    await addParticipants(otherTenant, otherTenantEvent.id, [{ bib: '401', name: 'Other Runner' }])
    await addParticipants(standard, standardEvent.id, [{ bib: '501', name: 'Standard Runner' }])
  })

  afterAll(async () => {
    await cleanupTenant(premium)
    await cleanupTenant(otherTenant)
    await cleanupTenant(standard)
  })

  it('gives every event its own token by default', () => {
    const tokens = [openEvent, siblingEvent, draftEvent, otherTenantEvent, standardEvent].map(
      (e) => e.claim_token
    )
    expect(new Set(tokens).size).toBe(tokens.length)
  })

  it('lists exactly the token’s own event — not a sibling event, not another tenant', async () => {
    const result = await loadClaimList(serviceClient(), openEvent.claim_token)

    expect(result.kind).toBe('open')
    if (result.kind !== 'open') return
    expect(result.participants.map((p) => p.name)).toEqual(['Lisa Nord', 'Karl Ström'])
    // Only the four fields leave the function.
    for (const p of result.participants) {
      expect(Object.keys(p).sort()).toEqual(['bib', 'claimed', 'id', 'name'])
    }
  })

  it('answers each event’s own token with that event only', async () => {
    const sibling = await loadClaimList(serviceClient(), siblingEvent.claim_token)
    const other = await loadClaimList(serviceClient(), otherTenantEvent.claim_token)

    expect(sibling.kind === 'open' && sibling.participants.map((p) => p.bib)).toEqual(['201'])
    expect(other.kind === 'open' && other.participants.map((p) => p.bib)).toEqual(['401'])
  })

  it('is closed for a draft event and for a Standard tenant, with no rows', async () => {
    const draft = await loadClaimList(serviceClient(), draftEvent.claim_token)
    const std = await loadClaimList(serviceClient(), standardEvent.claim_token)

    expect(draft).toEqual({
      kind: 'closed',
      event: expect.objectContaining({ name: 'Draft event' }),
    })
    expect(std).toEqual({
      kind: 'closed',
      event: expect.objectContaining({ name: 'Standard event' }),
    })
  })

  it('cannot be pointed at an event by its id instead of its token', async () => {
    expect(await loadClaimList(serviceClient(), openEvent.id)).toEqual({ kind: 'not_found' })
  })

  it('returns not_found for an unknown token', async () => {
    expect(await loadClaimList(serviceClient(), '00000000-0000-4000-8000-000000000000')).toEqual({
      kind: 'not_found',
    })
  })
})

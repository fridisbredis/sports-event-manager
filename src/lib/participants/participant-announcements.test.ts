import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadParticipantAnnouncements } from './participant-announcements'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getEventInfoCached } from '@/lib/events/event-info-cached'
import type { ResolvedParticipantTenant } from '@/lib/auth/tenant'

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/events/event-info-cached', () => ({ getEventInfoCached: vi.fn() }))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

function tenant(eventIds: string[], tier = 'premium'): ResolvedParticipantTenant {
  return {
    id: TENANT_ID,
    slug: 'viadal',
    color_palette: 'default',
    tier,
    is_active: true,
    entries: eventIds.map((eventId, i) => ({ participantId: `p${i}`, eventId })),
  } as ResolvedParticipantTenant
}

function infoFor(statusById: Record<string, string>) {
  vi.mocked(getEventInfoCached).mockImplementation(
    async (_tenantId, eventId) =>
      ({
        event: {
          name: `Event ${eventId}`,
          event_type: 'race',
          description: null,
          logo_url: null,
          status: statusById[eventId],
        },
        stages: [],
        info_sections: [],
      }) as never
  )
}

function announcementsQuery(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) builder[m] = vi.fn(() => builder)
  builder.range = vi.fn(() => Promise.resolve(result))
  const from = vi.fn(() => builder)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never)
  return { builder, from }
}

const row = (id: string, eventId: string) => ({
  id,
  event_id: eventId,
  body: `body ${id}`,
  published_at: '2026-08-01T10:00:00.000Z',
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadParticipantAnnouncements (N44)', () => {
  it('is closed without querying when every event is draft', async () => {
    infoFor({ e1: 'draft' })
    const { from } = announcementsQuery({ data: [], error: null })

    expect(await loadParticipantAnnouncements(tenant(['e1']), 1)).toEqual({ open: false })
    expect(from).not.toHaveBeenCalled()
  })

  it('is closed on Standard even for a published event (PB11)', async () => {
    infoFor({ e1: 'published' })
    announcementsQuery({ data: [], error: null })

    expect(await loadParticipantAnnouncements(tenant(['e1'], 'standard'), 1)).toEqual({
      open: false,
    })
  })

  it('reads the participant channel of open events only', async () => {
    infoFor({ e1: 'published', e2: 'draft' })
    const { builder, from } = announcementsQuery({ data: [row('a1', 'e1')], error: null })

    const result = await loadParticipantAnnouncements(tenant(['e1', 'e2']), 1)

    expect(from).toHaveBeenCalledWith('announcements')
    expect(builder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(builder.eq).toHaveBeenCalledWith('channel', 'participants')
    expect(builder.in).toHaveBeenCalledWith('event_id', ['e1'])
    expect(builder.order).toHaveBeenCalledWith('published_at', { ascending: false })
    // One open event: no event name on the cards.
    expect(result).toEqual({
      open: true,
      hasMore: false,
      items: [
        { id: 'a1', body: 'body a1', publishedAt: '2026-08-01T10:00:00.000Z', eventName: null },
      ],
    })
  })

  it('names the event on each announcement when several are open', async () => {
    infoFor({ e1: 'published', e2: 'published' })
    announcementsQuery({ data: [row('a1', 'e2')], error: null })

    const result = await loadParticipantAnnouncements(tenant(['e1', 'e2']), 1)

    expect(result.open && result.items[0].eventName).toBe('Event e2')
  })

  it('pages by 20 and reports an older page', async () => {
    infoFor({ e1: 'published' })
    const rows = Array.from({ length: 21 }, (_, i) => row(`a${i}`, 'e1'))
    const { builder } = announcementsQuery({ data: rows, error: null })

    const result = await loadParticipantAnnouncements(tenant(['e1']), 2)

    expect(builder.range).toHaveBeenCalledWith(20, 40)
    expect(result.open && result.items).toHaveLength(20)
    expect(result.open && result.hasMore).toBe(true)
  })

  it('throws on a failed read rather than showing an empty timeline (F-REL-10)', async () => {
    infoFor({ e1: 'published' })
    announcementsQuery({ data: null, error: new Error('boom') })

    await expect(loadParticipantAnnouncements(tenant(['e1']), 1)).rejects.toThrow('boom')
  })
})

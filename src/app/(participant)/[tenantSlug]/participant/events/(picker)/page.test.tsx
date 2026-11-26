import { describe, it, expect, vi, beforeEach } from 'vitest'
import { redirect } from 'next/navigation'
import { getCurrentUser, getParticipantTenant } from '@/lib/auth/tenant'
import { getEventInfoCached, type EventInfoCached } from '@/lib/events/event-info-cached'
import ParticipantEventPickerPage from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/link', () => ({ default: () => null }))

vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getParticipantTenant: vi.fn(),
}))
vi.mock('@/lib/events/event-info-cached', () => ({ getEventInfoCached: vi.fn() }))
vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(async () => (key: string) => key),
}))
vi.mock('@/lib/i18n/user-language', () => ({ getUserLanguage: vi.fn(async () => 'en') }))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const params = Promise.resolve({ tenantSlug: 'viadal' })

function mockEntries(entries: Array<{ participantId: string; eventId: string }>) {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
  vi.mocked(getParticipantTenant).mockResolvedValue({
    id: TENANT_ID,
    slug: 'viadal',
    color_palette: 'default',
    tier: 'premium',
    is_active: true,
    entries,
  })
}

function mockInfo(byEvent: Record<string, { name: string; status: string }>) {
  vi.mocked(getEventInfoCached).mockImplementation(async (_tenantId, eventId) => {
    const e = byEvent[eventId]
    const info: EventInfoCached = {
      event: {
        name: e.name,
        event_type: 'race',
        description: null,
        logo_url: null,
        status: e.status,
      },
      stages: [],
      info_sections: [],
    }
    return info
  })
}

// B29: the Event info tab's destination for a participant in several events.
describe('ParticipantEventPickerPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('goes straight to the info of an only event', async () => {
    mockEntries([{ participantId: 'p1', eventId: 'e1' }])
    await expect(ParticipantEventPickerPage({ params })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/viadal/participant/events/e1/info')
  })

  it('counts events, not entries: two records in one event open it directly', async () => {
    mockEntries([
      { participantId: 'p1', eventId: 'e1' },
      { participantId: 'p2', eventId: 'e1' },
    ])
    await expect(ParticipantEventPickerPage({ params })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/viadal/participant/events/e1/info')
  })

  it('lists every event the participant is entered in', async () => {
    mockEntries([
      { participantId: 'p1', eventId: 'e1' },
      { participantId: 'p2', eventId: 'e2' },
    ])
    mockInfo({
      e1: { name: 'Micke testar', status: 'published' },
      e2: { name: 'Micke testar 2', status: 'published' },
    })
    const flat = JSON.stringify(await ParticipantEventPickerPage({ params }))
    expect(flat).toContain('Micke testar')
    expect(flat).toContain('Micke testar 2')
    expect(flat).not.toContain('participant.home.notAvailableTitle')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('asks only about the caller’s own events', async () => {
    mockEntries([
      { participantId: 'p1', eventId: 'e1' },
      { participantId: 'p2', eventId: 'e2' },
    ])
    mockInfo({
      e1: { name: 'A', status: 'published' },
      e2: { name: 'B', status: 'published' },
    })
    await ParticipantEventPickerPage({ params })
    expect(vi.mocked(getEventInfoCached).mock.calls).toEqual([
      [TENANT_ID, 'e1'],
      [TENANT_ID, 'e2'],
    ])
  })

  it('marks an event that is not open to participants yet', async () => {
    mockEntries([
      { participantId: 'p1', eventId: 'e1' },
      { participantId: 'p2', eventId: 'e2' },
    ])
    mockInfo({
      e1: { name: 'Open', status: 'published' },
      e2: { name: 'Draft', status: 'draft' },
    })
    const flat = JSON.stringify(await ParticipantEventPickerPage({ params }))
    expect(flat.match(/participant\.home\.notAvailableTitle/g)).toHaveLength(1)
  })

  it('is a 404 for someone who is not a participant in the tenant', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(getParticipantTenant).mockResolvedValue(null)
    await expect(ParticipantEventPickerPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

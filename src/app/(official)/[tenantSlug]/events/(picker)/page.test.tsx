import { describe, it, expect, vi, beforeEach } from 'vitest'
import { redirect } from 'next/navigation'
import { listMemberEvents, type EventRole } from '@/lib/events/official-event'
import OfficialEventPickerPage from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/link', () => ({ default: () => null }))

vi.mock('@/lib/events/official-event', () => ({ listMemberEvents: vi.fn() }))
vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(async () => (key: string) => key),
}))
vi.mock('@/lib/i18n/user-language', () => ({ getUserLanguage: vi.fn(async () => 'en') }))

const params = Promise.resolve({ tenantSlug: 'viadal' })
const event = (id: string, isNew = false, roles: EventRole[] = ['official']) => ({
  id,
  name: id,
  start_date: '2026-06-01',
  end_date: '2026-06-06',
  status: 'published',
  isNew,
  roles,
  canOpen: roles.includes('official'),
})

// N23: the picker after login and behind "Change event".
describe('OfficialEventPickerPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('goes straight to the home of an only event — nothing to choose', async () => {
    vi.mocked(listMemberEvents).mockResolvedValue([event('e1')])
    await expect(OfficialEventPickerPage({ params })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/viadal/events/e1/home')
  })

  it('lists several events, marking the ones added since last opened', async () => {
    vi.mocked(listMemberEvents).mockResolvedValue([event('e2027', true), event('e2026')])
    const flat = JSON.stringify(await OfficialEventPickerPage({ params }))
    expect(flat).toContain('e2027')
    expect(flat).toContain('e2026')
    expect(flat.match(/events\.new/g)).toHaveLength(1)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('shows an empty state to an official with no events', async () => {
    vi.mocked(listMemberEvents).mockResolvedValue([])
    const flat = JSON.stringify(await OfficialEventPickerPage({ params }))
    expect(flat).toContain('events.emptyTitle')
  })

  it('shows no role labels to someone who is only an official', async () => {
    vi.mocked(listMemberEvents).mockResolvedValue([event('e1'), event('e2')])
    const flat = JSON.stringify(await OfficialEventPickerPage({ params }))
    expect(flat).not.toContain('events.role.')
  })

  // N35 (L5): official in one event, participant in another.
  it('names the role held in each event once the person is also a participant', async () => {
    vi.mocked(listMemberEvents).mockResolvedValue([
      event('race-2027', false, ['participant']),
      event('race-2026', false, ['official', 'participant']),
      event('relay-2026'),
    ])
    const flat = JSON.stringify(await OfficialEventPickerPage({ params }))
    expect(flat.match(/events\.role\.participant/g)).toHaveLength(2)
    expect(flat.match(/events\.role\.official/g)).toHaveLength(2)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('does not redirect into an event that has no screens for the caller yet', async () => {
    // Participant screens are N43: a participant-only event is listed, not opened.
    vi.mocked(listMemberEvents).mockResolvedValue([event('race', false, ['participant'])])
    const flat = JSON.stringify(await OfficialEventPickerPage({ params }))
    expect(flat).toContain('race')
    expect(redirect).not.toHaveBeenCalled()
  })
})

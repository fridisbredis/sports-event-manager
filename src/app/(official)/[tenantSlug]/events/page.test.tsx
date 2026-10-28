import { describe, it, expect, vi, beforeEach } from 'vitest'
import { redirect } from 'next/navigation'
import { listOfficialEvents } from '@/lib/events/official-event'
import OfficialEventPickerPage from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/link', () => ({ default: () => null }))

vi.mock('@/lib/events/official-event', () => ({ listOfficialEvents: vi.fn() }))
vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(async () => (key: string) => key),
}))
vi.mock('@/lib/i18n/user-language', () => ({ getUserLanguage: vi.fn(async () => 'en') }))

const params = Promise.resolve({ tenantSlug: 'viadal' })
const event = (id: string, isNew = false) => ({
  id,
  name: id,
  start_date: '2026-06-01',
  end_date: '2026-06-06',
  status: 'published',
  isNew,
})

// N23: the picker after login and behind "Change event".
describe('OfficialEventPickerPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('goes straight to the home of an only event — nothing to choose', async () => {
    vi.mocked(listOfficialEvents).mockResolvedValue([event('e1')])
    await expect(OfficialEventPickerPage({ params })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/viadal/events/e1/home')
  })

  it('lists several events, marking the ones added since last opened', async () => {
    vi.mocked(listOfficialEvents).mockResolvedValue([event('e2027', true), event('e2026')])
    const flat = JSON.stringify(await OfficialEventPickerPage({ params }))
    expect(flat).toContain('e2027')
    expect(flat).toContain('e2026')
    expect(flat.match(/events\.new/g)).toHaveLength(1)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('shows an empty state to an official with no events', async () => {
    vi.mocked(listOfficialEvents).mockResolvedValue([])
    const flat = JSON.stringify(await OfficialEventPickerPage({ params }))
    expect(flat).toContain('events.emptyTitle')
  })
})

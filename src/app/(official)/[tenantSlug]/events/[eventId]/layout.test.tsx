import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notFound } from 'next/navigation'
import { after } from 'next/server'
import { getOfficialEvent } from '@/lib/events/official-event'
import OfficialEventLayout from './layout'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/server', () => ({ after: vi.fn() }))

const rpc = vi.fn(async () => ({ error: null }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ rpc })),
}))

vi.mock('@/lib/events/official-event', () => ({
  getOfficialEvent: vi.fn(),
}))

const params = Promise.resolve({ tenantSlug: 'viadal', eventId: 'e1' })

// N23: the gate that keeps an official out of events they were not invited to.
describe('OfficialEventLayout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s an event the caller may not open, and marks nothing seen', async () => {
    vi.mocked(getOfficialEvent).mockResolvedValue(null)
    await expect(OfficialEventLayout({ children: 'CHILD', params })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(notFound).toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('renders the event and clears its "new" notice after the response', async () => {
    vi.mocked(getOfficialEvent).mockResolvedValue({ id: 'e1' })
    expect(await OfficialEventLayout({ children: 'CHILD', params })).toBe('CHILD')

    const callback = vi.mocked(after).mock.calls[0][0] as () => Promise<void>
    await callback()
    expect(rpc).toHaveBeenCalledWith('mark_official_event_seen', { p_event_id: 'e1' })
  })
})

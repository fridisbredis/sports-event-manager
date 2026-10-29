import { describe, it, expect, vi, beforeEach } from 'vitest'
import { redirect, notFound } from 'next/navigation'
import { getDefaultAdminEventId } from '@/lib/events/admin-event'
import LegacyAdminRedirect from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/events/admin-event', () => ({
  getDefaultAdminEventId: vi.fn(),
}))

function call(legacy: string[], search: Record<string, string | string[]> = {}) {
  return LegacyAdminRedirect({
    params: Promise.resolve({ tenantSlug: 'viadal', legacy }),
    searchParams: Promise.resolve(search),
  })
}

// N23: pre-event-segment admin URLs must keep working — bookmarks, sent
// links and the post-login redirect of a client deployed before the move.
describe('legacy admin URL redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDefaultAdminEventId).mockResolvedValue('e1')
  })

  it('sends an old screen URL to the same screen of the default event', async () => {
    await expect(call(['scheduling'])).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/viadal/admin/events/e1/scheduling')
  })

  it('keeps deeper segments and the query string', async () => {
    await expect(
      call(['workstations', 'ws-1'], { day: '2026-06-01', tag: ['a', 'b'] })
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith(
      '/viadal/admin/events/e1/workstations/ws-1?day=2026-06-01&tag=a&tag=b'
    )
  })

  it('404s a path that was never an admin screen', async () => {
    await expect(call(['nonsense'])).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
    expect(getDefaultAdminEventId).not.toHaveBeenCalled()
  })

  it('falls back to the admin index when the tenant has no event', async () => {
    vi.mocked(getDefaultAdminEventId).mockResolvedValue(null)
    await expect(call(['dashboard'])).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/viadal/admin')
  })
})

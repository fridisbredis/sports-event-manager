import { describe, it, expect, vi, beforeEach } from 'vitest'
import { redirect, notFound } from 'next/navigation'
import { getSoleOfficialEventId } from '@/lib/events/official-event'
import LegacyOfficialRedirect from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/events/official-event', () => ({ getSoleOfficialEventId: vi.fn() }))

function call(legacy: string[], search: Record<string, string> = {}) {
  return LegacyOfficialRedirect({
    params: Promise.resolve({ tenantSlug: 'viadal', legacy }),
    searchParams: Promise.resolve(search),
  })
}

// N23: links sent by SMS before the move (/viadal/home, /viadal/schedule?day=)
// must keep working.
describe('legacy official URL redirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it("sends an old screen URL to the same screen of the official's only event", async () => {
    vi.mocked(getSoleOfficialEventId).mockResolvedValue('e1')
    await expect(call(['schedule'], { day: '2026-06-02' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/viadal/events/e1/schedule?day=2026-06-02')
  })

  it('asks an official with several events to pick one', async () => {
    vi.mocked(getSoleOfficialEventId).mockResolvedValue(null)
    await expect(call(['home'])).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/viadal/events')
  })

  it('404s a path that was never an official screen', async () => {
    await expect(call(['nonsense'])).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })
})

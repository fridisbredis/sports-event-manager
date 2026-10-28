import { describe, it, expect, vi } from 'vitest'
import { notFound } from 'next/navigation'
import { getAdminEvent } from '@/lib/events/admin-event'
import AdminEventLayout from './layout'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/events/admin-event', () => ({
  getAdminEvent: vi.fn(),
}))

const params = Promise.resolve({ tenantSlug: 'viadal', eventId: 'e1' })

// N23: the gate that lets every event screen trust the eventId in its URL.
describe('AdminEventLayout', () => {
  it("404s an event that is not this tenant's", async () => {
    vi.mocked(getAdminEvent).mockResolvedValue(null)
    await expect(AdminEventLayout({ children: 'CHILD', params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
    expect(getAdminEvent).toHaveBeenCalledWith('viadal', 'e1')
  })

  it("renders the screen for the tenant's own event", async () => {
    vi.mocked(getAdminEvent).mockResolvedValue({ id: 'e1', tenant_id: 't1', status: 'draft' })
    expect(await AdminEventLayout({ children: 'CHILD', params })).toBe('CHILD')
  })
})

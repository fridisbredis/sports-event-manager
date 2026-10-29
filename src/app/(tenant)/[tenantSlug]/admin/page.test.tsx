import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notFound } from 'next/navigation'
import { getAdminTenant } from '@/lib/auth/tenant'
import { readTenantEvents, type TenantEventSummary } from '@/lib/events/tenant-events'
import TenantDashboardPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/link', () => ({ default: () => null }))

vi.mock('@/lib/auth/tenant', () => ({ getAdminTenant: vi.fn() }))
// readTenantEvents is mocked below; the page's own read is the stages query
// for the create-event dialog.
vi.mock('@/lib/supabase/server', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq']) chain[method] = () => chain
  chain.order = async () => ({ data: [], error: null })
  return { createSupabaseServerClient: vi.fn(async () => ({ from: () => chain })) }
})
// A client component; the page test only cares what it is handed.
vi.mock('./_components/create-event-dialog', () => ({ CreateEventDialog: () => null }))
vi.mock('@/lib/events/tenant-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/events/tenant-events')>()),
  readTenantEvents: vi.fn(),
}))
vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(
    async () => (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key
  ),
}))
vi.mock('@/lib/i18n/user-language', () => ({ getUserLanguage: vi.fn(async () => 'en') }))
// An async server component; the page test only cares which events it is
// handed, which the element's props carry.
vi.mock('./_components/event-card', () => ({ EventCard: () => null }))

const params = Promise.resolve({ tenantSlug: 'viadal' })
const search = (status?: string) => Promise.resolve(status ? { status } : {})

function event(id: string, status: string): TenantEventSummary {
  return {
    id,
    name: id,
    start_date: null,
    end_date: null,
    status,
    stageCount: 0,
    officialsInvited: 0,
    officialsConfirmed: 0,
    participantCount: 0,
  }
}

const EVENTS = [event('e-2027', 'draft'), event('e-2026', 'published'), event('e-2025', 'archived')]

function tenant(tier: string) {
  return { id: 't1', slug: 'viadal', color_palette: 'blue', tier, is_active: true }
}

// The event ids the rendered list hands to EventCard, in order.
function listedIds(tree: unknown): string[] {
  return [...JSON.stringify(tree).matchAll(/"event":\{"id":"([^"]+)"/g)].map((m) => m[1])
}

// N23 / TEN-01: the tenant dashboard.
describe('TenantDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAdminTenant).mockResolvedValue(tenant('premium'))
    vi.mocked(readTenantEvents).mockResolvedValue(EVENTS)
  })

  it('404s for a caller who is not this tenant’s admin', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(null)
    await expect(TenantDashboardPage({ params, searchParams: search() })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(notFound).toHaveBeenCalled()
  })

  it('lists every event and counts the non-archived against the tier cap', async () => {
    const tree = await TenantDashboardPage({ params, searchParams: search() })
    expect(listedIds(tree)).toEqual(['e-2027', 'e-2026', 'e-2025'])
    expect(JSON.stringify(tree)).toContain('events.activeOfCap:{\\"active\\":2,\\"cap\\":5}')
  })

  it('filters by status, while the active count still covers every event', async () => {
    const tree = await TenantDashboardPage({ params, searchParams: search('archived') })
    expect(listedIds(tree)).toEqual(['e-2025'])
    expect(JSON.stringify(tree)).toContain('\\"active\\":2')
  })

  it('ignores a status it does not know', async () => {
    const tree = await TenantDashboardPage({ params, searchParams: search('deleted') })
    expect(listedIds(tree)).toHaveLength(3)
  })

  it('tells an empty filter apart from a tenant with no events', async () => {
    vi.mocked(readTenantEvents).mockResolvedValue([event('e-2026', 'published')])
    const filtered = JSON.stringify(
      await TenantDashboardPage({ params, searchParams: search('draft') })
    )
    expect(filtered).toContain('events.noMatching.draft')
    expect(filtered).not.toContain('events.noEventsTitle')

    vi.mocked(readTenantEvents).mockResolvedValue([])
    const none = JSON.stringify(await TenantDashboardPage({ params, searchParams: search() }))
    expect(none).toContain('events.noEventsTitle')
  })

  // Premium allows 5 and EVENTS has 2 active: room left. Standard allows 1.
  it.each([
    ['premium', false],
    ['standard', true],
  ])('on %s, disables Create event at the cap: %s', async (tier, atCap) => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant(tier))
    const tree = JSON.stringify(await TenantDashboardPage({ params, searchParams: search() }))
    expect(tree.includes('"capMessage":"events.createEvent.capArchiveFirst"')).toBe(atCap)
  })

  it.each([
    ['standard', false],
    ['premium', true],
  ])('shows participant figures on %s: %s', async (tier, shown) => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant(tier))
    const tree = JSON.stringify(await TenantDashboardPage({ params, searchParams: search() }))
    expect(tree).toContain(`"showParticipants":${shown}`)
  })
})

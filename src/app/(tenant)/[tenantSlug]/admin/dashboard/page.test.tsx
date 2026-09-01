import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardPage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { OfficialsCard } from './_components/officials-card'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

// getAdminTenant resolves the tenant only after the admin access check passes,
// so a null return means either "no such tenant" or "not authorized". Both are
// notFound() to the caller — an unauthorized caller must not be able to probe
// for tenant existence.
vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getAdminTenant: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(async () => (key: string) => key),
}))

vi.mock('./_components/dashboard-header', () => ({
  DashboardHeader: vi.fn(() => null),
}))
vi.mock('./_components/publish-section', () => ({
  PublishSection: vi.fn(() => null),
}))
vi.mock('./_components/officials-card', () => ({
  OfficialsCard: vi.fn(() => null),
}))
vi.mock('./_components/scheduling-warnings-card', () => ({
  SchedulingWarningsCard: vi.fn(() => null),
}))
vi.mock('./_components/admin-areas-grid', () => ({
  AdminAreasGrid: vi.fn(() => null),
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const TENANT = { id: TENANT_ID, name: 'Viadal', slug: 'viadal' }
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })
const EVENT = {
  id: 'evt-1',
  name: 'Viadal 2026',
  event_type: 'trail',
  start_date: '2026-06-01',
  end_date: '2026-06-02',
  status: 'draft',
  scheduling_granularity_min: 30,
  logo_url: null,
}

// The scheduling-warning tile is not what these tests are about, but the page
// calls scheduling_warning_counts on every render that has an event, so the
// RPC needs a stub or the officials assertions never get reached.
const WARNING_COUNTS = {
  over_capacity: 0,
  double_booked: 0,
  earliest_day: null,
  earliest_stage_id: null,
}

function findByType(node: unknown, target: unknown): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== 'object') return null
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (el.type === target) return el as { props: Record<string, unknown> }
  const children = el.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByType(child, target)
      if (found) return found
    }
  } else if (children) {
    return findByType(children, target)
  }
  return null
}

interface OfficialsCounts {
  invited?: { count: number | null; error?: unknown }
  confirmed?: { count: number | null; error?: unknown }
}

/**
 * The two officials reads are head-counts distinguished only by their
 * `invite_status` filter, so the mock records each chain's `.eq` arguments and
 * resolves the matching result. That is what makes a swapped or dropped filter
 * visible — the counts would otherwise both pass with one shared stub.
 */
function mockServerClient(counts: OfficialsCounts = {}) {
  const officialsCalls: Array<Record<string, unknown>> = []

  const fromMock = vi.fn((table: string) => {
    if (table === 'officials') {
      const filters: Record<string, unknown> = {}
      officialsCalls.push(filters)
      const builder: Record<string, unknown> = {}
      builder.select = vi.fn((cols: string, opts?: unknown) => {
        filters.select = cols
        filters.selectOpts = opts
        return builder
      })
      builder.eq = vi.fn((col: string, val: unknown) => {
        filters[col] = val
        // Resolve once the status filter — the last link in the chain — lands.
        if (col === 'invite_status') {
          const which = val === 'invited' ? counts.invited : counts.confirmed
          return Promise.resolve(which ?? { count: 0, error: null })
        }
        return builder
      })
      return builder
    }

    if (table === 'event_stages') {
      const builder: Record<string, unknown> = {}
      builder.select = vi.fn(() => builder)
      let eqCount = 0
      builder.eq = vi.fn(() => {
        eqCount += 1
        return eqCount < 2 ? builder : Promise.resolve({ count: 1, error: null })
      })
      return builder
    }

    // events
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => builder)
    builder.eq = vi.fn(() => builder)
    builder.maybeSingle = vi.fn(() => Promise.resolve({ data: EVENT, error: null }))
    return builder
  })

  vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
  vi.mocked(getAdminTenant).mockResolvedValue(TENANT as never)
  const rpcMock = vi.fn(() => ({
    single: vi.fn(() => Promise.resolve({ data: WARNING_COUNTS, error: null })),
  }))

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    from: fromMock,
    rpc: rpcMock,
  } as never)
  return { fromMock, rpcMock, officialsCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockServerClient()
    vi.mocked(getCurrentUser).mockResolvedValue(null as never)

    await expect(DashboardPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAdminTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when the user lacks admin access to the tenant', async () => {
    mockServerClient()
    vi.mocked(getAdminTenant).mockResolvedValue(null as never)

    await expect(DashboardPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
  })

  it('counts officials with two head-counts rather than fetching rows (PERF-06)', async () => {
    const { officialsCalls } = mockServerClient({
      invited: { count: 4, error: null },
      confirmed: { count: 11, error: null },
    })

    await DashboardPage({ params: PARAMS })

    expect(officialsCalls).toHaveLength(2)
    for (const call of officialsCalls) {
      // head: true means no rows cross the wire — the point of the change.
      expect(call.selectOpts).toEqual({ count: 'exact', head: true })
      expect(call.tenant_id).toBe(TENANT_ID)
    }
    expect(officialsCalls.map((c) => c.invite_status)).toEqual(['invited', 'confirmed'])
  })

  it('passes each status count to OfficialsCard without transposing them', async () => {
    mockServerClient({
      invited: { count: 4, error: null },
      confirmed: { count: 11, error: null },
    })

    const result = await DashboardPage({ params: PARAMS })

    const card = findByType(result, OfficialsCard)
    expect(card).not.toBeNull()
    expect(card!.props.invited).toBe(4)
    expect(card!.props.confirmed).toBe(11)
  })

  it('treats a null count as zero rather than rendering undefined', async () => {
    mockServerClient({
      invited: { count: null, error: null },
      confirmed: { count: null, error: null },
    })

    const result = await DashboardPage({ params: PARAMS })

    const card = findByType(result, OfficialsCard)
    expect(card!.props.invited).toBe(0)
    expect(card!.props.confirmed).toBe(0)
  })

  it('throws when either count query fails instead of reporting zero officials', async () => {
    mockServerClient({
      invited: { count: null, error: new Error('invited count failed') },
      confirmed: { count: 11, error: null },
    })

    await expect(DashboardPage({ params: PARAMS })).rejects.toThrow('invited count failed')
  })

  it('throws when the confirmed count fails, not only the invited one', async () => {
    mockServerClient({
      invited: { count: 4, error: null },
      confirmed: { count: null, error: new Error('confirmed count failed') },
    })

    await expect(DashboardPage({ params: PARAMS })).rejects.toThrow('confirmed count failed')
  })
})

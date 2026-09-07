import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardPage from './page'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { OfficialsCard } from './_components/officials-card'
import { PublishSection } from './_components/publish-section'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

// PERF-06 / F-PERF-04 Phase 3: unstable_cache would otherwise need a real
// Next.js request/cache context (same "static generation store missing"
// problem revalidateTag hits in these unit tests) — mocked as a passthrough
// so the wrapped function runs directly and these tests exercise it without
// caching or its context requirements getting in the way.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
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

// PERF-06 / F-PERF-04 Phase 3: the event read, both officials head-counts,
// the race-stage count, and the scheduling-warning counts all moved onto
// get_admin_dashboard_cached (migration 0052) via the service-role client —
// see the page's own comment for why.
function mockDashboardRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc } as never)
  return rpc
}

function dashboardPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: EVENT,
    officials_invited: 4,
    officials_confirmed: 11,
    race_stage_count: 1,
    over_capacity: 0,
    double_booked: 0,
    earliest_day: null,
    earliest_stage_id: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
  vi.mocked(getAdminTenant).mockResolvedValue(TENANT as never)
})

describe('DashboardPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never)

    await expect(DashboardPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAdminTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when the user lacks admin access to the tenant', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(null as never)

    await expect(DashboardPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
  })

  it('reads the dashboard summary via the cached RPC scoped by tenant_id', async () => {
    const rpc = mockDashboardRpc({ data: dashboardPayload(), error: null })

    await DashboardPage({ params: PARAMS })

    expect(rpc).toHaveBeenCalledWith('get_admin_dashboard_cached', {
      p_tenant_id: TENANT_ID,
    })
  })

  it('passes each officials status count to OfficialsCard without transposing them', async () => {
    mockDashboardRpc({
      data: dashboardPayload({ officials_invited: 4, officials_confirmed: 11 }),
      error: null,
    })

    const result = await DashboardPage({ params: PARAMS })

    const card = findByType(result, OfficialsCard)
    expect(card).not.toBeNull()
    expect(card!.props.invited).toBe(4)
    expect(card!.props.confirmed).toBe(11)
  })

  it('renders successfully with zero officials and race-stage counts', async () => {
    mockDashboardRpc({
      data: dashboardPayload({
        officials_invited: 0,
        officials_confirmed: 0,
        race_stage_count: 0,
      }),
      error: null,
    })

    const result = await DashboardPage({ params: PARAMS })

    const card = findByType(result, OfficialsCard)
    expect(card!.props.invited).toBe(0)
    expect(card!.props.confirmed).toBe(0)
  })

  it('throws when the RPC returns an error', async () => {
    mockDashboardRpc({ data: null, error: new Error('rpc failed') })

    await expect(DashboardPage({ params: PARAMS })).rejects.toThrow('rpc failed')
  })

  it('builds the scheduling review link from the earliest warning when present', async () => {
    mockDashboardRpc({
      data: dashboardPayload({
        over_capacity: 2,
        double_booked: 1,
        earliest_day: '2026-06-01',
        earliest_stage_id: 'stage-1',
      }),
      error: null,
    })

    const result = await DashboardPage({ params: PARAMS })

    const card = findByType(result, (await import('./_components/scheduling-warnings-card'))
      .SchedulingWarningsCard)
    expect(card!.props.reviewHref).toBe(
      `/viadal/admin/scheduling?day=2026-06-01&stage=stage-1`
    )
    expect(card!.props.overCapacity).toBe(2)
    expect(card!.props.doubleBooked).toBe(1)
  })

  it('falls back to the plain scheduling link when there is no warning yet', async () => {
    mockDashboardRpc({ data: dashboardPayload(), error: null })

    const result = await DashboardPage({ params: PARAMS })

    const card = findByType(result, (await import('./_components/scheduling-warnings-card'))
      .SchedulingWarningsCard)
    expect(card!.props.reviewHref).toBe('/viadal/admin/scheduling')
  })

  // Regression coverage for #132 (fix(dashboard): stop crashing when a
  // tenant has no event yet), carried over from the pre-Phase-3 direct-query
  // tests: PublishSection reads `eventId={event?.id ?? null}`, not a
  // non-null assertion, so a null `event` in the cached payload must not
  // throw.
  it('renders without throwing when the tenant has no event yet, passing eventId: null', async () => {
    mockDashboardRpc({
      data: dashboardPayload({
        event: null,
        officials_invited: 0,
        officials_confirmed: 0,
        race_stage_count: 0,
      }),
      error: null,
    })

    const result = await DashboardPage({ params: PARAMS })

    const section = findByType(result, PublishSection)
    expect(section).not.toBeNull()
    expect(section!.props.eventId).toBeNull()
  })
})

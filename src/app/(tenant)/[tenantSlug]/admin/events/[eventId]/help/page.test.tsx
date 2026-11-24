import { describe, it, expect, vi, beforeEach } from 'vitest'
import HelpPage from './page'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { HelpGuide } from './_components/help-guide'
import { fetchAdminGuideDismissed } from '@/lib/onboarding/admin-guide-dismissal'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
  createSupabaseServerClient: vi.fn(async () => ({})),
}))

vi.mock('@/lib/onboarding/admin-guide-counts', () => ({
  fetchAdminGuideCounts: vi.fn(async () => ({ workAreaCount: 2, assignedShiftCount: 5 })),
}))

vi.mock('@/lib/onboarding/admin-guide-dismissal', () => ({
  fetchAdminGuideDismissed: vi.fn(async () => true),
}))

// Passthrough, as in the dashboard's test: unstable_cache needs a real
// Next.js cache context otherwise.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))

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

vi.mock('./_components/help-guide', () => ({
  HelpGuide: vi.fn(() => null),
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const TENANT = { id: TENANT_ID, name: 'Viadal', slug: 'viadal', tier: 'professional' }
const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const PARAMS = Promise.resolve({ tenantSlug: 'viadal', eventId: EVENT_ID })
const EVENT = {
  id: EVENT_ID,
  name: 'Viadal 2026',
  event_type: 'trail',
  start_date: '2026-06-01',
  end_date: '2026-06-02',
  status: 'published',
  scheduling_granularity_min: 60,
  logo_url: null,
}

function mockDashboardRpc(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null })
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc } as never)
  return rpc
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
  vi.mocked(getAdminTenant).mockResolvedValue(TENANT as never)
})

describe('HelpPage (B22)', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never)

    await expect(HelpPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('calls notFound when the user lacks admin access to the tenant', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(null as never)

    await expect(HelpPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('calls notFound when the event does not exist', async () => {
    mockDashboardRpc({ event: null, officials_confirmed: 0, race_stage_count: 0 })

    await expect(HelpPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders the guide with live progress and the dashboard hide choice, scoped by tenant and event', async () => {
    const rpc = mockDashboardRpc({ event: EVENT, officials_confirmed: 11, race_stage_count: 1 })

    const result = await HelpPage({ params: PARAMS })

    expect(rpc).toHaveBeenCalledWith('get_admin_dashboard_cached', {
      p_tenant_id: TENANT_ID,
      p_event_id: EVENT_ID,
    })
    expect(fetchAdminGuideDismissed).toHaveBeenCalledWith(expect.anything(), 'user-1', EVENT_ID)
    expect(findByType(result, HelpGuide)?.props).toMatchObject({
      tenantSlug: 'viadal',
      eventId: EVENT_ID,
      hiddenOnDashboard: true,
      eventConfigComplete: true,
      workAreaCount: 2,
      confirmedOfficialCount: 11,
      assignedShiftCount: 5,
      isPublished: true,
      tierAllowsPublish: true,
    })
  })
})

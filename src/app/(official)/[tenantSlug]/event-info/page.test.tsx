import { describe, it, expect, vi, beforeEach } from 'vitest'
import EventInfoPage from './page'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

// PERF-06 / F-PERF-04 Phase 2: unstable_cache would otherwise need a real
// Next.js request/cache context (same "static generation store missing"
// problem revalidateTag hits in these unit tests) — mocked as a passthrough
// so the wrapped function runs directly and these tests exercise it without
// caching or its context requirements getting in the way.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))

// getOfficialTenant resolves the tenant only after the official-surface
// access check passes, so a null return means either "no such tenant" or
// "not authorized" — both are notFound() to the caller, by design.
vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getOfficialTenant: vi.fn(),
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
  getServerTranslation: vi.fn().mockResolvedValue((key: string) => key),
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

function mockUser(userId: string | null) {
  vi.mocked(getCurrentUser).mockResolvedValue((userId ? { id: userId } : null) as never)
}

function mockResolvedTenant() {
  vi.mocked(getOfficialTenant).mockResolvedValue({
    id: TENANT_ID,
    slug: 'viadal',
    color_palette: 'default',
    is_active: true,
    officialId: null,
  })
}

// PERF-06 / F-PERF-04 Phase 2: the event/stages/facilities reads moved off
// the session client onto get_event_info_cached (migration 0051) via the
// service-role client — see the page's own comment for why.
function mockEventInfoRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc } as never)
  return rpc
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EventInfoPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null)

    await expect(EventInfoPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(getOfficialTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when getOfficialTenant denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(getOfficialTenant).mockResolvedValue(null)

    await expect(EventInfoPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')
  })

  it('reads event, stages, and facilities via the cached RPC scoped by tenant_id', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    const rpc = mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [],
        facilities: [],
      },
      error: null,
    })

    await EventInfoPage({ params: PARAMS })

    expect(rpc).toHaveBeenCalledWith('get_event_info_cached', {
      p_tenant_id: TENANT_ID,
    })
  })

  it('renders successfully with empty stages and facilities lists', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({ data: { event: null, stages: [], facilities: [] }, error: null })

    const result = await EventInfoPage({ params: PARAMS })

    expect(result).toBeTruthy()
  })

  // The dates-by-stage section derives a stage's day from start_time when it
  // is set and from stage_date otherwise, so a stage whose hour has not been
  // pinned yet still appears. Both branches render through the same page, so
  // these assert the page builds rather than re-testing the formatter.
  it('renders stages that carry only stage_date, with no start_time', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [
          {
            id: 'stage-1',
            name: 'Stage 1',
            stage_type: 'race',
            stage_date: '2026-06-12',
            start_time: null,
            end_time: null,
            venue: 'Town Square',
            position: 0,
          },
        ],
        facilities: [],
      },
      error: null,
    })

    const result = await EventInfoPage({ params: PARAMS })

    expect(result).toBeTruthy()
  })

  it('renders stages that carry neither a date nor a venue', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [
          {
            id: 'stage-1',
            name: 'Setup',
            stage_type: 'non_race',
            stage_date: null,
            start_time: null,
            end_time: null,
            venue: null,
            position: 0,
          },
        ],
        facilities: [],
      },
      error: null,
    })

    const result = await EventInfoPage({ params: PARAMS })

    expect(result).toBeTruthy()
  })

  it('throws when the RPC returns an error', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({ data: null, error: new Error('rpc failed') })

    await expect(EventInfoPage({ params: PARAMS })).rejects.toThrow('rpc failed')
  })
})

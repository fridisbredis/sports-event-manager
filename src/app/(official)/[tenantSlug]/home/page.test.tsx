import { describe, it, expect, vi, beforeEach } from 'vitest'
import OfficialHomePage from './page'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

// PERF-06 / F-PERF-04 Phase 1: unstable_cache would otherwise need a real
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

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  return builder
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

function mockUser(userId: string | null, fromMock: ReturnType<typeof vi.fn> = vi.fn()) {
  vi.mocked(getCurrentUser).mockResolvedValue((userId ? { id: userId } : null) as never)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)
}

// PERF-06 / F-PERF-04 Phase 1: the officials read moved off the session
// client onto get_official_home_cached (migration 0048) via the
// service-role client — see the page's own comment for why.
function mockOfficialHomeRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc } as never)
  return rpc
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OfficialHomePage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    const fromMock = vi.fn()
    mockUser(null, fromMock)

    await expect(OfficialHomePage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(getOfficialTenant).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('calls notFound when getOfficialTenant denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(getOfficialTenant).mockResolvedValue(null)

    await expect(OfficialHomePage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')
  })

  it('reads the confirmed official via the cached RPC scoped by tenant and user, and events by tenant_id via the session client', async () => {
    vi.mocked(getOfficialTenant).mockResolvedValue({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'default',
      is_active: true,
      officialId: null,
    })
    const eventsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn().mockReturnValue(eventsBuilder)
    mockUser('user-1', fromMock)
    const rpc = mockOfficialHomeRpc({ data: { name: 'Anna' }, error: null })

    await OfficialHomePage({ params: PARAMS })

    expect(rpc).toHaveBeenCalledWith('get_official_home_cached', {
      p_tenant_id: TENANT_ID,
      p_user_id: 'user-1',
    })
    expect(fromMock).toHaveBeenCalledWith('events')
    expect(eventsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('renders successfully when neither an official nor an event is found', async () => {
    vi.mocked(getOfficialTenant).mockResolvedValue({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'default',
      is_active: true,
      officialId: null,
    })
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: null })))
    mockOfficialHomeRpc({ data: { name: null }, error: null })

    const result = await OfficialHomePage({ params: PARAMS })

    expect(result).toBeTruthy()
  })
})

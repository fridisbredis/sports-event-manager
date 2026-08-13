import { describe, it, expect, vi, beforeEach } from 'vitest'
import EventInfoPage from './page'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { resolveTenantForOfficial } from '@/lib/auth/tenant'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  resolveTenantForOfficial: vi.fn(),
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
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

function mockUser(userId: string | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
  } as never)
}

function mockResolvedTenant() {
  vi.mocked(resolveTenantForOfficial).mockResolvedValue({
    id: TENANT_ID,
    slug: 'viadal',
    color_palette: 'default',
    is_active: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EventInfoPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null)

    await expect(EventInfoPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(resolveTenantForOfficial).not.toHaveBeenCalled()
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('calls notFound when resolveTenantForOfficial denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(resolveTenantForOfficial).mockResolvedValue(null)

    await expect(EventInfoPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(resolveTenantForOfficial).toHaveBeenCalledWith('viadal', 'user-1')
  })

  it('scopes events, event_stages, and event_facilities queries by tenant_id', async () => {
    mockUser('user-1')
    mockResolvedTenant()
    const eventBuilder = chain({ data: { name: 'Viadal 2026' } })
    const stagesBuilder = chain({ data: [] })
    const facilitiesBuilder = chain({ data: [] })
    const serviceFromMock = vi.fn()
    serviceFromMock
      .mockReturnValueOnce(eventBuilder)
      .mockReturnValueOnce(stagesBuilder)
      .mockReturnValueOnce(facilitiesBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: serviceFromMock } as never)

    await EventInfoPage({ params: PARAMS })

    expect(serviceFromMock).toHaveBeenCalledWith('events')
    expect(eventBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(serviceFromMock).toHaveBeenCalledWith('event_stages')
    expect(stagesBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(serviceFromMock).toHaveBeenCalledWith('event_facilities')
    expect(facilitiesBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('renders successfully with empty stages and facilities lists', async () => {
    mockUser('user-1')
    mockResolvedTenant()
    const serviceFromMock = vi.fn().mockReturnValue(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: serviceFromMock } as never)

    const result = await EventInfoPage({ params: PARAMS })

    expect(result).toBeTruthy()
  })
})

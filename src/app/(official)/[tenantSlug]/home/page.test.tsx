import { describe, it, expect, vi, beforeEach } from 'vitest'
import OfficialHomePage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveTenantForOfficial } from '@/lib/auth/tenant'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
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
  builder.limit = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  return builder
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

function mockUser(userId: string | null, fromMock: ReturnType<typeof vi.fn> = vi.fn()) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from: fromMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OfficialHomePage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    const fromMock = vi.fn()
    mockUser(null, fromMock)

    await expect(OfficialHomePage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(resolveTenantForOfficial).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('calls notFound when resolveTenantForOfficial denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(resolveTenantForOfficial).mockResolvedValue(null)

    await expect(OfficialHomePage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(resolveTenantForOfficial).toHaveBeenCalledWith('viadal', 'user-1')
  })

  it('scopes the officials lookup by user_id and tenant_id, and events by tenant_id only', async () => {
    vi.mocked(resolveTenantForOfficial).mockResolvedValue({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'default',
      is_active: true,
    })
    const officialsBuilder = chain({ data: { name: 'Anna' } })
    const eventsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(officialsBuilder).mockReturnValueOnce(eventsBuilder)
    mockUser('user-1', fromMock)

    await OfficialHomePage({ params: PARAMS })

    expect(fromMock).toHaveBeenCalledWith('officials')
    expect(officialsBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(officialsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(fromMock).toHaveBeenCalledWith('events')
    expect(eventsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('renders successfully when neither an official nor an event is found', async () => {
    vi.mocked(resolveTenantForOfficial).mockResolvedValue({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'default',
      is_active: true,
    })
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: null })))

    const result = await OfficialHomePage({ params: PARAMS })

    expect(result).toBeTruthy()
  })
})

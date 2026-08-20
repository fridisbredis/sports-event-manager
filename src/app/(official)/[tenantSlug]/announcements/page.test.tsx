import { describe, it, expect, vi, beforeEach } from 'vitest'
import AnnouncementsPage from './page'
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
  builder.order = vi.fn(() => Promise.resolve(result))
  builder.single = vi.fn(() => Promise.resolve(result))
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

describe('AnnouncementsPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    const fromMock = vi.fn()
    mockUser(null, fromMock)

    await expect(AnnouncementsPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(resolveTenantForOfficial).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('calls notFound when resolveTenantForOfficial denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(resolveTenantForOfficial).mockResolvedValue(null)

    await expect(AnnouncementsPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(resolveTenantForOfficial).toHaveBeenCalledWith('viadal', 'user-1')
  })

  it('scopes announcements by tenant_id and the officials channel only', async () => {
    mockResolvedTenant()
    const announcementsBuilder = chain({ data: [] })
    const fromMock = vi.fn().mockReturnValue(announcementsBuilder)
    mockUser('user-1', fromMock)

    await AnnouncementsPage({ params: PARAMS })

    expect(fromMock).toHaveBeenCalledWith('announcements')
    expect(announcementsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(announcementsBuilder.eq).toHaveBeenCalledWith('channel', 'officials')
  })

  it('renders the empty state when there are no announcements', async () => {
    mockResolvedTenant()
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: [] })))

    const result = await AnnouncementsPage({ params: PARAMS })

    expect(JSON.stringify(result)).toContain('announcements.noAnnouncements')
  })

  it('renders announcement cards when announcements exist', async () => {
    mockResolvedTenant()
    const announcements = [{ id: 'a-1', body: 'Hej alla', published_at: new Date().toISOString() }]
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: announcements })))

    const result = await AnnouncementsPage({ params: PARAMS })

    expect(JSON.stringify(result)).not.toContain('announcements.noAnnouncements')
    expect(JSON.stringify(result)).toContain('Hej alla')
  })
})

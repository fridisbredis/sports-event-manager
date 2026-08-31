import { describe, it, expect, vi, beforeEach } from 'vitest'
import AnnouncementsPage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
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
  builder.order = vi.fn(() => Promise.resolve(result))
  builder.single = vi.fn(() => Promise.resolve(result))
  return builder
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

function mockUser(userId: string | null, fromMock: ReturnType<typeof vi.fn> = vi.fn()) {
  vi.mocked(getCurrentUser).mockResolvedValue((userId ? { id: userId } : null) as never)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)
}

function mockResolvedTenant() {
  vi.mocked(getOfficialTenant).mockResolvedValue({
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
    expect(getOfficialTenant).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('calls notFound when getOfficialTenant denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(getOfficialTenant).mockResolvedValue(null)

    await expect(AnnouncementsPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')
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

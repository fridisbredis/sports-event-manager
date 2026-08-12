import { describe, it, expect, vi, beforeEach } from 'vitest'
import AnnouncementsPage from './page'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
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

function mockUser(userId: string | null, tenant: unknown) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from: vi.fn().mockReturnValue(chain({ data: tenant })),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AnnouncementsPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null, null)

    await expect(AnnouncementsPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('calls notFound when the tenant slug does not resolve', async () => {
    mockUser('user-1', null)

    await expect(AnnouncementsPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('scopes announcements by tenant_id and the officials channel only', async () => {
    mockUser('user-1', { id: TENANT_ID })
    const announcementsBuilder = chain({ data: [] })
    const serviceFromMock = vi.fn().mockReturnValue(announcementsBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: serviceFromMock } as never)

    await AnnouncementsPage({ params: PARAMS })

    expect(serviceFromMock).toHaveBeenCalledWith('announcements')
    expect(announcementsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(announcementsBuilder.eq).toHaveBeenCalledWith('channel', 'officials')
  })

  it('renders the empty state when there are no announcements', async () => {
    mockUser('user-1', { id: TENANT_ID })
    const serviceFromMock = vi.fn().mockReturnValue(chain({ data: [] }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: serviceFromMock } as never)

    const result = await AnnouncementsPage({ params: PARAMS })

    expect(JSON.stringify(result)).toContain('announcements.noAnnouncements')
  })

  it('renders announcement cards when announcements exist', async () => {
    mockUser('user-1', { id: TENANT_ID })
    const announcements = [{ id: 'a-1', body: 'Hej alla', published_at: new Date().toISOString() }]
    const serviceFromMock = vi.fn().mockReturnValue(chain({ data: announcements }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: serviceFromMock } as never)

    const result = await AnnouncementsPage({ params: PARAMS })

    expect(JSON.stringify(result)).not.toContain('announcements.noAnnouncements')
    expect(JSON.stringify(result)).toContain('Hej alla')
  })
})

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

// next/link's real module namespace object is circular, which breaks the
// JSON.stringify tree assertions below. The pager only needs an element
// identity — its href and label live in props either way.
vi.mock('next/link', () => ({
  default: ({ children }: { children?: unknown }) => children,
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.range = vi.fn(() => Promise.resolve(result))
  builder.single = vi.fn(() => Promise.resolve(result))
  return builder
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })
const NO_SEARCH = Promise.resolve({})

function search(page: string) {
  return Promise.resolve({ page })
}

const BASE_TIME = Date.parse('2026-08-01T10:00:00.000Z')

/** n announcements, newest first, distinguishable by body. */
function announcements(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `a-${i}`,
    body: `body-${i}`,
    published_at: new Date(BASE_TIME - i * 60_000).toISOString(),
  }))
}

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

    await expect(AnnouncementsPage({ params: PARAMS, searchParams: NO_SEARCH })).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(getOfficialTenant).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('calls notFound when getOfficialTenant denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(getOfficialTenant).mockResolvedValue(null)

    await expect(AnnouncementsPage({ params: PARAMS, searchParams: NO_SEARCH })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')
  })

  it('scopes announcements by tenant_id and the officials channel only', async () => {
    mockResolvedTenant()
    const announcementsBuilder = chain({ data: [] })
    const fromMock = vi.fn().mockReturnValue(announcementsBuilder)
    mockUser('user-1', fromMock)

    await AnnouncementsPage({ params: PARAMS, searchParams: NO_SEARCH })

    expect(fromMock).toHaveBeenCalledWith('announcements')
    expect(announcementsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(announcementsBuilder.eq).toHaveBeenCalledWith('channel', 'officials')
  })

  // PERF-06: the read is paged, not capped. The range asks for one row past
  // the page so the "older" link needs no second count query.
  it('bounds the read to one page plus a sentinel row', async () => {
    mockResolvedTenant()
    const builder = chain({ data: [] })
    mockUser('user-1', vi.fn().mockReturnValue(builder))

    await AnnouncementsPage({ params: PARAMS, searchParams: NO_SEARCH })

    expect(builder.range).toHaveBeenCalledWith(0, 20)
  })

  it('offsets the range by whole pages for ?page=', async () => {
    mockResolvedTenant()
    const builder = chain({ data: [] })
    mockUser('user-1', vi.fn().mockReturnValue(builder))

    await AnnouncementsPage({ params: PARAMS, searchParams: search('3') })

    expect(builder.range).toHaveBeenCalledWith(40, 60)
  })

  it('falls back to page 1 for a tampered ?page=', async () => {
    mockResolvedTenant()
    const builder = chain({ data: [] })
    mockUser('user-1', vi.fn().mockReturnValue(builder))

    await AnnouncementsPage({ params: PARAMS, searchParams: search('-9') })

    expect(builder.range).toHaveBeenCalledWith(0, 20)
  })

  it('renders the empty state when there are no announcements', async () => {
    mockResolvedTenant()
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: [] })))

    const result = await AnnouncementsPage({ params: PARAMS, searchParams: NO_SEARCH })

    expect(JSON.stringify(result)).toContain('announcements.noAnnouncements')
  })

  it('renders announcement cards when announcements exist', async () => {
    mockResolvedTenant()
    const rows = [{ id: 'a-1', body: 'Hej alla', published_at: new Date().toISOString() }]
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: rows })))

    const result = await AnnouncementsPage({ params: PARAMS, searchParams: NO_SEARCH })

    expect(JSON.stringify(result)).not.toContain('announcements.noAnnouncements')
    expect(JSON.stringify(result)).toContain('Hej alla')
  })

  it('hides the sentinel row and offers the older page', async () => {
    mockResolvedTenant()
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: announcements(21) })))

    const result = await AnnouncementsPage({ params: PARAMS, searchParams: NO_SEARCH })
    const json = JSON.stringify(result)

    expect(json).toContain('body-19')
    expect(json).not.toContain('body-20')
    expect(json).toContain('announcements.older')
    expect(json).not.toContain('announcements.newer')
  })

  it('offers no older page when the result is a partial page', async () => {
    mockResolvedTenant()
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: announcements(5) })))

    const result = await AnnouncementsPage({ params: PARAMS, searchParams: NO_SEARCH })

    expect(JSON.stringify(result)).not.toContain('announcements.older')
  })

  it('offers the newer page when past page 1', async () => {
    mockResolvedTenant()
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: announcements(5) })))

    const result = await AnnouncementsPage({ params: PARAMS, searchParams: search('2') })

    expect(JSON.stringify(result)).toContain('announcements.newer')
  })

  // Past the end of the list is not the same as having no announcements —
  // a bookmarked ?page= must not read as "the organizer has posted nothing".
  it('distinguishes past-the-end from having no announcements at all', async () => {
    mockResolvedTenant()
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: [] })))

    const result = await AnnouncementsPage({ params: PARAMS, searchParams: search('4') })
    const json = JSON.stringify(result)

    expect(json).toContain('announcements.noOlderAnnouncements')
    expect(json).toContain('announcements.backToNewest')
    expect(json).not.toContain('announcements.noAnnouncementsDescription')
  })

  it('throws when the announcements query fails', async () => {
    mockResolvedTenant()
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: null, error: new Error('boom') })))

    await expect(AnnouncementsPage({ params: PARAMS, searchParams: NO_SEARCH })).rejects.toThrow(
      'boom'
    )
  })
})

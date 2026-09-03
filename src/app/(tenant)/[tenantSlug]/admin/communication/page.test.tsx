import { describe, it, expect, vi, beforeEach } from 'vitest'
import CommunicationPage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { CommunicationPanel } from './_components/communication-panel'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

// getAdminTenant resolves the tenant only after the admin access check passes,
// so a null return means either "no such tenant" or "not authorized". Both are
// notFound() to the caller, which is deliberate: an unauthorized caller must not
// be able to probe for tenant existence.
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

vi.mock('./_components/communication-panel', () => ({
  CommunicationPanel: vi.fn(() => null),
}))

type ChannelResults = Partial<Record<'participants' | 'officials', unknown>>

/**
 * One builder per `from('announcements')` call. The page issues one query per
 * channel, so the builder resolves from whichever channel its own
 * `.eq('channel', …)` captured rather than from call order.
 */
function announcementsChain(byChannel: ChannelResults) {
  const builder: Record<string, unknown> = {}
  let channel: 'participants' | 'officials' | null = null
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn((column: string, value: string) => {
    if (column === 'channel') channel = value as 'participants' | 'officials'
    return builder
  })
  builder.order = vi.fn(() => builder)
  builder.range = vi.fn(() => Promise.resolve((channel && byChannel[channel]) ?? { data: [] }))
  return builder
}

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.range = vi.fn(() => Promise.resolve(result))
  builder.single = vi.fn(() => Promise.resolve(result))
  return builder
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

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const TENANT = { id: TENANT_ID, name: 'Viadal', slug: 'viadal' }
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })
const NO_SEARCH = Promise.resolve({})

function search(page: string) {
  return Promise.resolve({ page })
}

// Fixed so the same call twice — once for the mock, once for the expectation —
// produces identical rows regardless of clock ticks.
const BASE_TIME = Date.parse('2026-08-01T10:00:00.000Z')

/** n announcements on one channel, distinguishable by id. */
function announcements(channel: 'participants' | 'officials', n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${channel}-${i}`,
    tenant_id: TENANT_ID,
    channel,
    body: `body-${i}`,
    sms_sent: false,
    published_at: new Date(BASE_TIME - i * 60_000).toISOString(),
    created_at: new Date(BASE_TIME - i * 60_000).toISOString(),
  }))
}

function mockServerClient(userId: string | null, tenant: unknown, byChannel: ChannelResults = {}) {
  const builders: Record<string, unknown>[] = []
  const fromMock = vi.fn((table: string) => {
    if (table === 'announcements') {
      const builder = announcementsChain(byChannel)
      builders.push(builder)
      return builder
    }
    return chain({ data: tenant })
  })
  vi.mocked(getCurrentUser).mockResolvedValue((userId ? { id: userId } : null) as never)
  vi.mocked(getAdminTenant).mockResolvedValue(tenant as never)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)
  return { fromMock, builders }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CommunicationPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockServerClient(null, null)

    await expect(CommunicationPage({ params: PARAMS, searchParams: NO_SEARCH })).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(getAdminTenant).not.toHaveBeenCalled()
  })

  // getAdminTenant returns null for both a denied access check and a missing
  // tenant, so this can't distinguish the two — name it for what it covers.
  it('calls notFound when getAdminTenant denies access or the tenant is missing', async () => {
    mockServerClient('user-1', null)

    await expect(CommunicationPage({ params: PARAMS, searchParams: NO_SEARCH })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
  })

  // One query per channel, not one over the mixed list: the panel's toggle is
  // local state, so a page of the mixed list could leave one timeline looking
  // empty while older announcements exist on it.
  it('reads each channel separately and scopes both to the tenant', async () => {
    const { fromMock, builders } = mockServerClient('user-1', TENANT, {
      participants: { data: announcements('participants', 2) },
      officials: { data: announcements('officials', 1) },
    })

    await CommunicationPage({ params: PARAMS, searchParams: NO_SEARCH })

    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(fromMock).toHaveBeenCalledWith('announcements')
    expect(builders).toHaveLength(2)
    for (const builder of builders) {
      expect(builder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    }
    const channels = builders.flatMap((b) =>
      (b.eq as ReturnType<typeof vi.fn>).mock.calls
        .filter(([column]) => column === 'channel')
        .map(([, value]) => value)
    )
    expect(channels.sort()).toEqual(['officials', 'participants'])
  })

  it('passes each channel its own list to CommunicationPanel', async () => {
    mockServerClient('user-1', TENANT, {
      participants: { data: announcements('participants', 2) },
      officials: { data: announcements('officials', 1) },
    })

    const result = await CommunicationPage({ params: PARAMS, searchParams: NO_SEARCH })
    const panel = findByType(result, CommunicationPanel)

    expect(panel).not.toBeNull()
    expect(panel!.props.tenantId).toBe(TENANT_ID)
    expect(panel!.props.page).toBe(1)
    expect(panel!.props.announcements).toEqual({
      participants: announcements('participants', 2),
      officials: announcements('officials', 1),
    })
    expect(panel!.props.hasMore).toEqual({ participants: false, officials: false })
  })

  // PERF-06: bounded to one page plus a sentinel row, so hasMore costs no
  // second count query.
  it('bounds both reads to one page plus a sentinel row', async () => {
    const { builders } = mockServerClient('user-1', TENANT)

    await CommunicationPage({ params: PARAMS, searchParams: NO_SEARCH })

    for (const builder of builders) {
      expect(builder.range).toHaveBeenCalledWith(0, 20)
    }
  })

  it('offsets the range by whole pages for ?page=', async () => {
    const { builders } = mockServerClient('user-1', TENANT)

    await CommunicationPage({ params: PARAMS, searchParams: search('3') })

    for (const builder of builders) {
      expect(builder.range).toHaveBeenCalledWith(40, 60)
    }
  })

  it('falls back to page 1 for a tampered ?page=', async () => {
    const { builders } = mockServerClient('user-1', TENANT)

    await CommunicationPage({ params: PARAMS, searchParams: search('nope') })

    for (const builder of builders) {
      expect(builder.range).toHaveBeenCalledWith(0, 20)
    }
  })

  it('drops the sentinel row and reports the older page per channel', async () => {
    mockServerClient('user-1', TENANT, {
      participants: { data: announcements('participants', 21) },
      officials: { data: announcements('officials', 3) },
    })

    const result = await CommunicationPage({ params: PARAMS, searchParams: NO_SEARCH })
    const panel = findByType(result, CommunicationPanel)

    const lists = panel!.props.announcements as Record<string, unknown[]>
    expect(lists.participants).toHaveLength(20)
    expect(lists.officials).toHaveLength(3)
    expect(panel!.props.hasMore).toEqual({ participants: true, officials: false })
  })

  it('passes empty arrays when a channel has no announcements', async () => {
    mockServerClient('user-1', TENANT, {
      participants: { data: null },
      officials: { data: null },
    })

    const result = await CommunicationPage({ params: PARAMS, searchParams: NO_SEARCH })
    const panel = findByType(result, CommunicationPanel)

    expect(panel!.props.announcements).toEqual({ participants: [], officials: [] })
    expect(panel!.props.hasMore).toEqual({ participants: false, officials: false })
  })

  it.each(['participants', 'officials'] as const)(
    'throws when the %s query fails',
    async (channel) => {
      mockServerClient('user-1', TENANT, {
        [channel]: { data: null, error: new Error('boom') },
      })

      await expect(CommunicationPage({ params: PARAMS, searchParams: NO_SEARCH })).rejects.toThrow(
        'boom'
      )
    }
  )
})

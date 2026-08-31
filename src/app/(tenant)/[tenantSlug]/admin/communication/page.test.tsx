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

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => Promise.resolve(result))
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
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

function mockServerClient(userId: string | null, tenant: unknown, announcementsResult?: unknown) {
  const fromMock = vi.fn((table: string) => {
    if (table === 'announcements') return chain(announcementsResult ?? { data: null })
    return chain({ data: tenant })
  })
  vi.mocked(getCurrentUser).mockResolvedValue((userId ? { id: userId } : null) as never)
  vi.mocked(getAdminTenant).mockResolvedValue(tenant as never)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)
  return fromMock
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CommunicationPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockServerClient(null, null)

    await expect(CommunicationPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(getAdminTenant).not.toHaveBeenCalled()
  })

  // getAdminTenant returns null for both a denied access check and a missing
  // tenant, so this can't distinguish the two — name it for what it covers.
  it('calls notFound when getAdminTenant denies access or the tenant is missing', async () => {
    mockServerClient('user-1', null)

    await expect(CommunicationPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
  })

  it('loads announcements for the tenant and passes them to CommunicationPanel', async () => {
    const announcements = [{ id: 'ann-1', channel: 'officials', body: 'hej' }]
    const fromMock = mockServerClient(
      'user-1',
      { id: TENANT_ID, name: 'Viadal', slug: 'viadal' },
      { data: announcements }
    )

    const result = await CommunicationPage({ params: PARAMS })

    expect(fromMock).toHaveBeenCalledWith('announcements')
    const announcementsBuilder = fromMock.mock.results.find(
      (r, i) => fromMock.mock.calls[i][0] === 'announcements'
    )!.value
    expect(announcementsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)

    const panel = findByType(result, CommunicationPanel)
    expect(panel).not.toBeNull()
    expect(panel!.props).toEqual({ tenantId: TENANT_ID, announcements })
  })

  it('passes an empty announcements array when the query returns no data', async () => {
    mockServerClient('user-1', { id: TENANT_ID, name: 'Viadal', slug: 'viadal' }, { data: null })

    const result = await CommunicationPage({ params: PARAMS })

    const panel = findByType(result, CommunicationPanel)
    expect(panel!.props.announcements).toEqual([])
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import CommunicationPage from './page'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { CommunicationPanel } from './_components/communication-panel'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  hasAdminAccessToTenant: vi.fn(),
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

function mockServerClient(userId: string | null, tenant: unknown) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }) },
    from: vi.fn().mockReturnValue(chain({ data: tenant })),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CommunicationPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockServerClient(null, null)

    await expect(CommunicationPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when the user lacks admin access to the tenant', async () => {
    mockServerClient('user-1', { id: TENANT_ID, name: 'Viadal', slug: 'viadal' })
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)

    await expect(CommunicationPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
  })

  it('loads announcements for the tenant and passes them to CommunicationPanel', async () => {
    mockServerClient('user-1', { id: TENANT_ID, name: 'Viadal', slug: 'viadal' })
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)

    const announcements = [{ id: 'ann-1', channel: 'officials', body: 'hej' }]
    const announcementsBuilder = chain({ data: announcements })
    const serviceFromMock = vi.fn().mockReturnValue(announcementsBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: serviceFromMock } as never)

    const result = await CommunicationPage({ params: PARAMS })

    expect(serviceFromMock).toHaveBeenCalledWith('announcements')
    expect(announcementsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)

    const panel = findByType(result, CommunicationPanel)
    expect(panel).not.toBeNull()
    expect(panel!.props).toEqual({ tenantId: TENANT_ID, announcements })
  })

  it('passes an empty announcements array when the query returns no data', async () => {
    mockServerClient('user-1', { id: TENANT_ID, name: 'Viadal', slug: 'viadal' })
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const serviceFromMock = vi.fn().mockReturnValue(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: serviceFromMock } as never)

    const result = await CommunicationPage({ params: PARAMS })

    const panel = findByType(result, CommunicationPanel)
    expect(panel!.props.announcements).toEqual([])
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import OfficialsPage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import OfficialsList from './_components/officials-list'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
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

vi.mock('./_components/officials-list', () => ({
  default: vi.fn(() => null),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.neq = vi.fn(() => builder)
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

function mockServerClient(userId: string | null, tenant: unknown, officialsResult?: unknown) {
  const fromMock = vi.fn((table: string) => {
    if (table === 'officials') return chain(officialsResult ?? { data: null })
    return chain({ data: tenant })
  })
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from: fromMock,
  } as never)
  return fromMock
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OfficialsPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockServerClient(null, null)

    await expect(OfficialsPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when the tenant slug does not resolve', async () => {
    mockServerClient('user-1', null)

    await expect(OfficialsPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when the user lacks admin access to the tenant', async () => {
    mockServerClient('user-1', { id: TENANT_ID, name: 'Viadal', slug: 'viadal' })
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)

    await expect(OfficialsPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
  })

  it('loads officials for the tenant and passes them to OfficialsList when access is granted', async () => {
    const officials = [{ id: 'off-1', name: 'Anna', invite_status: 'confirmed' }]
    const fromMock = mockServerClient(
      'user-1',
      { id: TENANT_ID, name: 'Viadal', slug: 'viadal' },
      { data: officials }
    )
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)

    const result = await OfficialsPage({ params: PARAMS })

    expect(fromMock).toHaveBeenCalledWith('officials')
    const officialsBuilder = fromMock.mock.results.find(
      (r, i) => fromMock.mock.calls[i][0] === 'officials'
    )!.value
    expect(officialsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(officialsBuilder.neq).toHaveBeenCalledWith('invite_status', 'removed')

    const list = findByType(result, OfficialsList)
    expect(list).not.toBeNull()
    expect(list!.props).toEqual({
      tenantSlug: 'viadal',
      tenantId: TENANT_ID,
      officials,
      currentUserId: 'user-1',
    })
  })

  it('passes an empty officials array when the query returns no data', async () => {
    mockServerClient('user-1', { id: TENANT_ID, name: 'Viadal', slug: 'viadal' }, { data: null })
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)

    const result = await OfficialsPage({ params: PARAMS })

    const list = findByType(result, OfficialsList)
    expect(list!.props.officials).toEqual([])
  })
})

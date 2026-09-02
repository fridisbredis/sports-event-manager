import { describe, it, expect, vi, beforeEach } from 'vitest'
import OfficialsPage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import OfficialsList from './_components/officials-list'
import { logger } from '@/lib/logger'

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

vi.mock('./_components/officials-list', () => ({
  default: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.neq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  // The officials read now ends at range, not order (PERF-06).
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
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

function mockServerClient(userId: string | null, tenant: unknown, officialsResult?: unknown) {
  const fromMock = vi.fn((table: string) => {
    if (table === 'officials') return chain(officialsResult ?? { data: null })
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

describe('OfficialsPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockServerClient(null, null)

    await expect(OfficialsPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAdminTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when the tenant slug does not resolve', async () => {
    mockServerClient('user-1', null)

    await expect(OfficialsPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
  })

  it('calls notFound when the user lacks admin access to the tenant', async () => {
    mockServerClient('user-1', null)

    await expect(OfficialsPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
  })

  it('loads officials for the tenant and passes them to OfficialsList when access is granted', async () => {
    const officials = [{ id: 'off-1', name: 'Anna', invite_status: 'confirmed' }]
    const fromMock = mockServerClient(
      'user-1',
      { id: TENANT_ID, name: 'Viadal', slug: 'viadal' },
      { data: officials }
    )

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

    const result = await OfficialsPage({ params: PARAMS })

    const list = findByType(result, OfficialsList)
    expect(list!.props.officials).toEqual([])
  })

  it('bounds the read, asking for one row past the ceiling (PERF-06)', async () => {
    const fromMock = mockServerClient(
      'user-1',
      { id: TENANT_ID, name: 'Viadal', slug: 'viadal' },
      { data: [] }
    )

    await OfficialsPage({ params: PARAMS })

    const officialsBuilder = fromMock.mock.results.find(
      (r, i) => fromMock.mock.calls[i][0] === 'officials'
    )!.value
    // 501 rows requested for a 500 ceiling: the extra row is what makes a
    // breach detectable instead of a silent truncation of the roster.
    expect(officialsBuilder.range).toHaveBeenCalledWith(0, 500)
  })

  it('warns and truncates to the ceiling when the ceiling is breached', async () => {
    const overflow = Array.from({ length: 501 }, (_, i) => ({
      id: `off-${i}`,
      name: `Official ${i}`,
      invite_status: 'confirmed',
    }))
    mockServerClient(
      'user-1',
      { id: TENANT_ID, name: 'Viadal', slug: 'viadal' },
      { data: overflow }
    )

    const result = await OfficialsPage({ params: PARAMS })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('read ceiling'),
      expect.objectContaining({ ceiling: 500, tenantId: TENANT_ID, page: 'admin/officials' })
    )
    const list = findByType(result, OfficialsList)
    expect(list!.props.officials).toHaveLength(500)
  })

  it('does not warn when the roster sits exactly on the ceiling', async () => {
    const atCeiling = Array.from({ length: 500 }, (_, i) => ({
      id: `off-${i}`,
      name: `Official ${i}`,
      invite_status: 'confirmed',
    }))
    mockServerClient(
      'user-1',
      { id: TENANT_ID, name: 'Viadal', slug: 'viadal' },
      { data: atCeiling }
    )

    const result = await OfficialsPage({ params: PARAMS })

    expect(logger.warn).not.toHaveBeenCalled()
    const list = findByType(result, OfficialsList)
    expect(list!.props.officials).toHaveLength(500)
  })
})

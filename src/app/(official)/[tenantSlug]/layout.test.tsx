import { describe, it, expect, vi, beforeEach } from 'vitest'
import OfficialLayout from './layout'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { BottomTabBar } from './_components/bottom-tab-bar'

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

vi.mock('./_components/bottom-tab-bar', () => ({
  BottomTabBar: vi.fn(() => null),
}))

vi.mock('@/lib/theme/tenant-theme-style', () => ({
  TenantThemeStyle: vi.fn(() => null),
}))

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

// The layout no longer queries Supabase itself — it resolves the caller and the
// tenant through the memoised helpers, which carry the access check.
function mockUser(userId: string | null, tenant: unknown) {
  vi.mocked(getCurrentUser).mockResolvedValue((userId ? { id: userId } : null) as never)
  vi.mocked(getOfficialTenant).mockResolvedValue(tenant as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OfficialLayout', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null, null)

    await expect(OfficialLayout({ children: null, params: PARAMS })).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getOfficialTenant).not.toHaveBeenCalled()
  })

  // A denied access check is indistinguishable from a missing tenant here, by
  // design: an unauthorized caller must not be able to probe for existence.
  // The two cases collapse to the same null return, so this is one test.
  it('calls notFound when getOfficialTenant denies access or the tenant is missing', async () => {
    mockUser('user-1', null)

    await expect(OfficialLayout({ children: null, params: PARAMS })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')
  })

  it('renders children and BottomTabBar when the user may view official surfaces', async () => {
    mockUser('user-1', {
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'blue',
      is_active: true,
    })

    const result = await OfficialLayout({ children: 'CHILD_CONTENT', params: PARAMS })

    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')

    const tabBar = findByType(result, BottomTabBar)
    expect(tabBar).not.toBeNull()
    expect(tabBar!.props).toEqual({ tenantSlug: 'viadal' })

    const flat = JSON.stringify(result)
    expect(flat).toContain('CHILD_CONTENT')
  })
})

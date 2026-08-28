import { describe, it, expect, vi, beforeEach } from 'vitest'
import TenantLayout from './layout'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { SidebarNav } from './_components/sidebar-nav'

// getAdminTenant resolves the tenant only after the admin access check passes,
// so a null return means either "no such tenant" or "not authorized" — the
// layout treats both as notFound(), which is what it did before F-PERF-07 too.
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

vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(async () => (key: string) => key),
}))

vi.mock('./_components/sidebar-nav', () => ({
  SidebarNav: vi.fn(() => null),
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TenantLayout', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    await expect(TenantLayout({ children: null, params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    // No point resolving a tenant for a caller we already know is anonymous.
    expect(getAdminTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when the tenant slug does not resolve', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(getAdminTenant).mockResolvedValue(null)

    await expect(TenantLayout({ children: null, params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
  })

  // Only a tenant_admin of this tenant or a system_admin may pass. The check
  // lives inside getAdminTenant (resolveTenantForAdmin -> hasAdminAccessToTenant),
  // which returns null when it fails — indistinguishable from a missing tenant
  // by design, so an unauthorized caller cannot probe for tenant existence.
  it('calls notFound when the user has no admin access to this tenant', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(getAdminTenant).mockResolvedValue(null)

    await expect(TenantLayout({ children: null, params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders children and SidebarNav when the user has admin access', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(getAdminTenant).mockResolvedValue({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'blue',
      is_active: true,
    })

    const result = await TenantLayout({ children: 'CHILD_CONTENT', params: PARAMS })

    expect(getAdminTenant).toHaveBeenCalledWith('viadal')

    const nav = findByType(result, SidebarNav)
    expect(nav).not.toBeNull()
    expect(nav!.props.tenantSlug).toBe('viadal')

    const flat = JSON.stringify(result)
    expect(flat).toContain('CHILD_CONTENT')
  })
})

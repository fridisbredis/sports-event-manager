import { describe, it, expect, vi, beforeEach } from 'vitest'
import TenantLayout, { SidebarChrome } from './layout'
import { getCurrentUser, getAdminTenant, hasAccountScreen } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { SidebarNav } from './_components/sidebar-nav'
import { DEFAULT_TENANT_PALETTE } from '@/lib/theme/tenant-colors'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

// getAdminTenant resolves the tenant only after the admin access check passes,
// so a null return means either "no such tenant" or "not authorized" — the
// layout treats both as notFound(), which is what it did before F-PERF-07 too.
vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getAdminTenant: vi.fn(),
  hasAccountScreen: vi.fn(),
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

// TenantThemeStyle is stubbed because it renders a raw <style> tag, but
// effectivePalette is kept REAL: it is the tier gate this layout depends on,
// and mocking it away would make the gating tests below assert nothing.
vi.mock('@/lib/theme/tenant-theme-style', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/theme/tenant-theme-style')>()),
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

  // getAdminTenant (resolveTenantForAdmin -> hasAdminAccessToTenant) returns
  // null for both a missing tenant and a failed admin access check, by design
  // — an unauthorized caller cannot probe for tenant existence. The two cases
  // are indistinguishable from here, so this is one test, not two.
  it('calls notFound when getAdminTenant denies access or the tenant is missing', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(getAdminTenant).mockResolvedValue(null)

    await expect(TenantLayout({ children: null, params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
  })

  it('renders children and SidebarNav when the user has admin access', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(hasAccountScreen).mockResolvedValue(true)
    vi.mocked(getAdminTenant).mockResolvedValue({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'blue',
      tier: 'professional',
      is_active: true,
    })

    const result = await TenantLayout({ children: 'CHILD_CONTENT', params: PARAMS })

    expect(getAdminTenant).toHaveBeenCalledWith('viadal')

    // SidebarNav is rendered by the suspended SidebarChrome, which the gate
    // above does not depend on — so the layout's own tree holds the chrome
    // element, and the nav is one await deeper.
    const chrome = findByType(result, SidebarChrome)
    expect(chrome).not.toBeNull()

    const nav = findByType(await SidebarChrome(chrome!.props as never), SidebarNav)
    expect(nav).not.toBeNull()
    expect(nav!.props.tenantSlug).toBe('viadal')

    const flat = JSON.stringify(result)
    expect(flat).toContain('CHILD_CONTENT')
  })

  // The colour theme is a tier feature (SYS-02): a tenant below the unlocking
  // tier renders the DEFAULT palette even though its row still holds another
  // choice — the stored value is ignored on read, never rewritten.
  it('paints the default palette for a tenant whose tier excludes the theme', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(hasAccountScreen).mockResolvedValue(true)
    vi.mocked(getAdminTenant).mockResolvedValue({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'purple',
      tier: 'standard',
      is_active: true,
    })

    const result = await TenantLayout({ children: null, params: PARAMS })

    const style = findByType(result, TenantThemeStyle)
    expect(style!.props.colorPalette).toBe(DEFAULT_TENANT_PALETTE)
  })

  it('paints the stored palette once the tier includes the theme', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(hasAccountScreen).mockResolvedValue(true)
    vi.mocked(getAdminTenant).mockResolvedValue({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'purple',
      tier: 'premium',
      is_active: true,
    })

    const result = await TenantLayout({ children: null, params: PARAMS })

    const style = findByType(result, TenantThemeStyle)
    expect(style!.props.colorPalette).toBe('purple')
  })

  // ACCT-01 is backed by an `officials` row, so the sidebar hides its link for
  // a caller without one — a global system_admin holds no roster row in any
  // tenant, and the page answers notFound() for them.
  it('passes showAccount through to SidebarNav', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(getAdminTenant).mockResolvedValue({
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'blue',
      tier: 'professional',
      is_active: true,
    })

    const chromeProps = { tenantSlug: 'viadal', adminLabel: 'Admin' }

    vi.mocked(hasAccountScreen).mockResolvedValue(false)
    let nav = findByType(await SidebarChrome(chromeProps), SidebarNav)
    expect(nav!.props.showAccount).toBe(false)

    vi.mocked(hasAccountScreen).mockResolvedValue(true)
    nav = findByType(await SidebarChrome(chromeProps), SidebarNav)
    expect(nav!.props.showAccount).toBe(true)
  })
})

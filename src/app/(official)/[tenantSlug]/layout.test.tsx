import { describe, it, expect, vi, beforeEach } from 'vitest'
import OfficialLayout, { AdminLinkChrome } from './layout'
import { getCurrentUser, getOfficialTenant, hasAdminScreens } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { BottomTabBar } from './_components/bottom-tab-bar'
import { AdminViewLink } from './_components/admin-view-link'

// getOfficialTenant resolves the tenant only after the official-surface
// access check passes, so a null return means either "no such tenant" or
// "not authorized" — both are notFound() to the caller, by design.
vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getOfficialTenant: vi.fn(),
  hasAdminScreens: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/events/official-event', () => ({
  getSoleOfficialEventId: vi.fn(async () => 'event-1'),
}))

vi.mock('./_components/bottom-tab-bar', () => ({
  BottomTabBar: vi.fn(() => null),
}))

vi.mock('./_components/admin-view-link', () => ({
  AdminViewLink: vi.fn(() => null),
}))

// TenantThemeStyle is stubbed because it renders a raw <style> tag, but
// effectivePalette is kept REAL: it is the tier gate this layout depends on.
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'
import { DEFAULT_TENANT_PALETTE } from '@/lib/theme/tenant-colors'

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

// The layout no longer queries Supabase itself — it resolves the caller and the
// tenant through the memoised helpers, which carry the access check.
function mockUser(userId: string | null, tenant: unknown, isAdmin = false) {
  vi.mocked(getCurrentUser).mockResolvedValue((userId ? { id: userId } : null) as never)
  vi.mocked(getOfficialTenant).mockResolvedValue(tenant as never)
  vi.mocked(hasAdminScreens).mockResolvedValue(isAdmin)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OfficialLayout', () => {
  // Officials see the tenant's theme too, so the tier gate has to hold on this
  // surface as well as the admin one.
  it('paints the default palette for a tenant whose tier excludes the theme', async () => {
    mockUser('user-1', {
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'purple',
      tier: 'standard',
      is_active: true,
      officialId: 'official-1',
    })

    const result = await OfficialLayout({ children: null, params: PARAMS })

    const style = findByType(result, TenantThemeStyle)
    expect(style!.props.colorPalette).toBe(DEFAULT_TENANT_PALETTE)
  })

  it('paints the stored palette once the tier includes the theme', async () => {
    mockUser('user-1', {
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'purple',
      tier: 'professional',
      is_active: true,
      officialId: 'official-1',
    })

    const result = await OfficialLayout({ children: null, params: PARAMS })

    const style = findByType(result, TenantThemeStyle)
    expect(style!.props.colorPalette).toBe('purple')
  })

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
      officialId: 'off-1',
    })

    const result = await OfficialLayout({ children: 'CHILD_CONTENT', params: PARAMS })

    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')

    const tabBar = findByType(result, BottomTabBar)
    expect(tabBar).not.toBeNull()
    expect(tabBar!.props).toEqual({
      tenantSlug: 'viadal',
      showAccount: true,
      defaultEventId: 'event-1',
    })

    const flat = JSON.stringify(result)
    expect(flat).toContain('CHILD_CONTENT')
  })

  // The access check allows an admin into official surfaces without a roster
  // row (officialId: null) so their schedule degrades to empty rather than
  // locking them out. ACCT-01 is the one screen that needs the row itself, so
  // the tab goes rather than leading to the notFound() the page answers.
  it('hides the account tab when the caller has no officials row', async () => {
    mockUser('user-1', {
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'blue',
      is_active: true,
      officialId: null,
    })

    const result = await OfficialLayout({ children: 'CHILD_CONTENT', params: PARAMS })

    expect(findByType(result, BottomTabBar)!.props.showAccount).toBe(false)
    expect(findByType(result, BottomTabBar)!.props.defaultEventId).toBe('event-1')
  })
  // The cross-surface link (both directions) exists because an admin who is
  // also on the roster has two surfaces for the same tenant and otherwise no
  // way between them but editing the URL.
  it('offers the admin view to a caller who passes the admin access check', async () => {
    mockUser(
      'user-1',
      {
        id: TENANT_ID,
        slug: 'viadal',
        color_palette: 'blue',
        is_active: true,
        officialId: 'off-1',
      },
      true
    )

    const result = await OfficialLayout({ children: 'CHILD_CONTENT', params: PARAMS })

    // AdminViewLink is rendered by the suspended AdminLinkChrome, which the
    // gate above does not depend on — so the layout's tree holds the chrome
    // element and the link is one await deeper.
    const chrome = findByType(result, AdminLinkChrome)
    expect(chrome).not.toBeNull()

    const link = findByType(await AdminLinkChrome(chrome!.props as never), AdminViewLink)
    expect(link).not.toBeNull()
    expect(link!.props).toEqual({ tenantSlug: 'viadal' })
  })

  it('hides the admin view from a plain official', async () => {
    mockUser('user-1', {
      id: TENANT_ID,
      slug: 'viadal',
      color_palette: 'blue',
      is_active: true,
      officialId: 'off-1',
    })

    const result = await OfficialLayout({ children: 'CHILD_CONTENT', params: PARAMS })

    expect(findByType(result, AdminViewLink)).toBeNull()
  })
})

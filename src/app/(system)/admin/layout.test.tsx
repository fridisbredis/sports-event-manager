import { describe, it, expect, vi, beforeEach } from 'vitest'
import SystemAdminLayout from './layout'
import { getOwnTenantSurfaces } from '@/lib/auth/tenant'
import { SidebarNav } from './_components/sidebar-nav'

// B19: the system admin menu's "Your tenants" section. Which tenants qualify is
// decided (and tested) in getOwnTenantSurfaces; this checks what the layout
// hands the menu.

vi.mock('@/lib/auth/tenant', () => ({
  getOwnTenantSurfaces: vi.fn(),
}))

vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(async () => (key: string) => key),
}))

vi.mock('@/lib/i18n/user-language', () => ({
  getUserLanguage: vi.fn(async () => 'en'),
}))

vi.mock('@/components/language-select', () => ({
  LanguageSelect: vi.fn(() => null),
}))

vi.mock('./_components/sidebar-nav', () => ({
  SidebarNav: vi.fn(() => null),
}))

function allByType(node: unknown, target: unknown, out: { props: Record<string, unknown> }[] = []) {
  if (!node || typeof node !== 'object') return out
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (el.type === target) out.push(el as { props: Record<string, unknown> })
  const children = el.props?.children
  for (const child of Array.isArray(children) ? children : [children]) allByType(child, target, out)
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SystemAdminLayout', () => {
  it('gives the menu no tenants for a system admin with no tenant roles (ADR-0004)', async () => {
    vi.mocked(getOwnTenantSurfaces).mockResolvedValue([])

    const navs = allByType(await SystemAdminLayout({ children: null }), SidebarNav)
    expect(navs).toHaveLength(2)
    for (const nav of navs) expect(nav.props.ownTenants).toEqual([])
  })

  it('links each tenant once: the admin view where admin, else the official view', async () => {
    vi.mocked(getOwnTenantSurfaces).mockResolvedValue([
      { slug: 'alpha', name: 'Alpha IK', admin: false, official: true },
      { slug: 'viadal', name: 'Viadal', admin: true, official: true },
    ])

    const navs = allByType(await SystemAdminLayout({ children: null }), SidebarNav)
    // Rail and drawer trigger get the same list.
    for (const nav of navs) {
      expect(nav.props.ownTenants).toEqual([
        { name: 'Alpha IK', href: '/alpha/events', officialOnly: true },
        { name: 'Viadal', href: '/viadal/admin', officialOnly: false },
      ])
    }
  })
})

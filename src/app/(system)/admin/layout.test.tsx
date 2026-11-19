import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OwnTenantLinks } from './layout'
import { getOwnTenantSurfaces } from '@/lib/auth/tenant'
import {
  SurfaceSwitchBar,
  type SurfaceSwitchTarget,
} from '@/components/navigation/surface-switch-bar'

// B19: the strip on the system admin pages that leads to the tenants where the
// user holds a role of their own. Which tenants qualify is decided (and tested)
// in getOwnTenantSurfaces; this checks what the strip makes of the answer.

vi.mock('@/lib/auth/tenant', () => ({
  getOwnTenantSurfaces: vi.fn(),
}))

vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(
    async () => (key: string, opts?: { tenant?: string }) => `${key}:${opts?.tenant ?? ''}`
  ),
}))

vi.mock('@/lib/i18n/user-language', () => ({
  getUserLanguage: vi.fn(async () => 'en'),
}))

vi.mock('@/components/navigation/surface-switch-bar', () => ({
  SurfaceSwitchBar: vi.fn(() => null),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function linksOf(node: unknown): SurfaceSwitchTarget[] {
  const el = node as { type: unknown; props: { links: SurfaceSwitchTarget[] } }
  expect(el.type).toBe(SurfaceSwitchBar)
  return el.props.links
}

describe('OwnTenantLinks', () => {
  it('renders nothing for a system admin with no tenant roles of their own (ADR-0004)', async () => {
    vi.mocked(getOwnTenantSurfaces).mockResolvedValue([])
    expect(await OwnTenantLinks()).toBeNull()
  })

  it('links to the admin view and the official view the user holds', async () => {
    vi.mocked(getOwnTenantSurfaces).mockResolvedValue([
      { slug: 'alpha', name: 'Alpha IK', admin: false, official: true },
      { slug: 'viadal', name: 'Viadal', admin: true, official: true },
    ])

    const links = linksOf(await OwnTenantLinks())
    expect(links.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: '/alpha/events', label: 'systemAdmin.ownTenantOfficial:Alpha IK' },
      { href: '/viadal/admin', label: 'systemAdmin.ownTenantAdmin:Viadal' },
      { href: '/viadal/events', label: 'systemAdmin.ownTenantOfficial:Viadal' },
    ])
  })
})

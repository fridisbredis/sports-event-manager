import { describe, it, expect, vi, beforeEach } from 'vitest'
import TenantLayout from './layout'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { SidebarNav } from './_components/sidebar-nav'

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

vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(async () => (key: string) => key),
}))

vi.mock('./_components/sidebar-nav', () => ({
  SidebarNav: vi.fn(() => null),
}))

vi.mock('@/lib/theme/tenant-theme-style', () => ({
  TenantThemeStyle: vi.fn(() => null),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
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

function mockUser(userId: string | null, tenant: unknown) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from: vi.fn().mockReturnValue(chain({ data: tenant })),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TenantLayout', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null, null)

    await expect(TenantLayout({ children: null, params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when the tenant slug does not resolve', async () => {
    mockUser('user-1', null)

    await expect(TenantLayout({ children: null, params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    // The tenant must resolve before the guard runs — the guard needs its id.
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  // Only a tenant_admin of this tenant or a system_admin may pass.
  it('calls notFound when the user has no admin access to this tenant', async () => {
    mockUser('user-1', { id: TENANT_ID, color_palette: null })
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)

    await expect(TenantLayout({ children: null, params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
  })

  it('renders children and SidebarNav when the user has admin access', async () => {
    mockUser('user-1', { id: TENANT_ID, color_palette: { primary: '#000' } })
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)

    const result = await TenantLayout({ children: 'CHILD_CONTENT', params: PARAMS })

    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)

    const nav = findByType(result, SidebarNav)
    expect(nav).not.toBeNull()
    expect(nav!.props.tenantSlug).toBe('viadal')

    const flat = JSON.stringify(result)
    expect(flat).toContain('CHILD_CONTENT')
  })
})

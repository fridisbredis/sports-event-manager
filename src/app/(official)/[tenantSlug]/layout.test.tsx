import { describe, it, expect, vi, beforeEach } from 'vitest'
import OfficialLayout from './layout'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canViewOfficialSurfaces } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { BottomTabBar } from './_components/bottom-tab-bar'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  canViewOfficialSurfaces: vi.fn(),
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

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
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

describe('OfficialLayout', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null, null)

    await expect(OfficialLayout({ children: null, params: PARAMS })).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(canViewOfficialSurfaces).not.toHaveBeenCalled()
  })

  it('calls notFound when the tenant slug does not resolve', async () => {
    mockUser('user-1', null)

    await expect(OfficialLayout({ children: null, params: PARAMS })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    // The tenant must resolve before the guard runs — the guard needs its id.
    expect(canViewOfficialSurfaces).not.toHaveBeenCalled()
  })

  it('calls notFound when the user may not view official surfaces', async () => {
    mockUser('user-1', { id: TENANT_ID, slug: 'viadal', color_palette: null })
    vi.mocked(canViewOfficialSurfaces).mockResolvedValue(false)

    await expect(OfficialLayout({ children: null, params: PARAMS })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(canViewOfficialSurfaces).toHaveBeenCalledWith('user-1', TENANT_ID)
  })

  it('renders children and BottomTabBar when the user may view official surfaces', async () => {
    mockUser('user-1', { id: TENANT_ID, slug: 'viadal', color_palette: { primary: '#000' } })
    vi.mocked(canViewOfficialSurfaces).mockResolvedValue(true)

    const result = await OfficialLayout({ children: 'CHILD_CONTENT', params: PARAMS })

    expect(canViewOfficialSurfaces).toHaveBeenCalledWith('user-1', TENANT_ID)

    const tabBar = findByType(result, BottomTabBar)
    expect(tabBar).not.toBeNull()
    expect(tabBar!.props).toEqual({ tenantSlug: 'viadal' })

    const flat = JSON.stringify(result)
    expect(flat).toContain('CHILD_CONTENT')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import OfficialLayout from './layout'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BottomTabBar } from './_components/bottom-tab-bar'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
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
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('calls notFound when the tenant slug does not resolve', async () => {
    mockUser('user-1', null)

    await expect(OfficialLayout({ children: null, params: PARAMS })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('calls notFound when the user has no user_roles row for this tenant', async () => {
    mockUser('user-1', { id: TENANT_ID, slug: 'viadal', color_palette: null })
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(chain({ data: null })),
    } as never)

    await expect(OfficialLayout({ children: null, params: PARAMS })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
  })

  it('renders children and BottomTabBar when a role row exists for this tenant', async () => {
    mockUser('user-1', { id: TENANT_ID, slug: 'viadal', color_palette: { primary: '#000' } })
    const roleBuilder = chain({ data: { role: 'official' } })
    const serviceFromMock = vi.fn().mockReturnValue(roleBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: serviceFromMock } as never)

    const result = await OfficialLayout({ children: 'CHILD_CONTENT', params: PARAMS })

    expect(serviceFromMock).toHaveBeenCalledWith('user_roles')
    expect(roleBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(roleBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)

    const tabBar = findByType(result, BottomTabBar)
    expect(tabBar).not.toBeNull()
    expect(tabBar!.props).toEqual({ tenantSlug: 'viadal' })

    const flat = JSON.stringify(result)
    expect(flat).toContain('CHILD_CONTENT')
  })
})

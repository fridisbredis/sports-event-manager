import { describe, it, expect, vi, beforeEach } from 'vitest'
import AdminAccountPage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import AdminAccountForm from './_components/admin-account-form'
import AccountForm from '@/app/(official)/[tenantSlug]/account/_components/account-form'

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

vi.mock('./_components/admin-account-form', () => ({
  default: vi.fn(() => null),
}))

vi.mock('@/app/(official)/[tenantSlug]/account/_components/account-form', () => ({
  default: vi.fn(() => null),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
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

function mockUser(
  userId: string | null,
  userMetadata: Record<string, unknown> = {},
  fromMock: ReturnType<typeof vi.fn> = vi.fn()
) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: userId ? { id: userId, user_metadata: userMetadata, phone: '0701234567' } : null,
        },
      }),
    },
    from: fromMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminAccountPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null)

    await expect(AdminAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when the user has no admin access to this tenant', async () => {
    const fromMock = vi.fn().mockReturnValue(chain({ data: { id: TENANT_ID } }))
    mockUser('user-1', {}, fromMock)
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)

    await expect(AdminAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
  })

  it('calls notFound when the resolved tenant slug does not exist', async () => {
    const fromMock = vi.fn().mockReturnValue(chain({ data: null }))
    mockUser('user-1', {}, fromMock)

    await expect(AdminAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    // The tenant must resolve before the guard runs — the guard needs its id.
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('renders AdminAccountForm with metadata name/phone when no official row exists yet', async () => {
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: TENANT_ID } })) // tenants
      .mockReturnValueOnce(chain({ data: null })) // officials — none
    mockUser('user-1', { name: 'Peter' }, fromMock)
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)

    const result = await AdminAccountPage({ params: PARAMS })

    const form = findByType(result, AdminAccountForm)
    expect(form).not.toBeNull()
    expect(form!.props).toEqual({ name: 'Peter', phone: '0701234567', tenantId: TENANT_ID })
  })

  it('renders AccountForm with the official row and assignment count when it exists', async () => {
    const official = { id: 'off-1', name: 'Peter', phone: '0701234567', sms_opt_out: false }
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: TENANT_ID } })) // tenants
      .mockReturnValueOnce(chain({ data: official })) // officials
      .mockReturnValueOnce(chain({ count: 3 })) // assignments count
    mockUser('user-1', {}, fromMock)
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)

    const result = await AdminAccountPage({ params: PARAMS })

    const form = findByType(result, AccountForm)
    expect(form).not.toBeNull()
    expect(form!.props).toEqual({
      name: 'Peter',
      phone: '0701234567',
      smsOptOut: false,
      tenantId: TENANT_ID,
      tenantSlug: 'viadal',
      assignmentCount: 3,
      i18nNamespace: 'admin',
      layout: 'desktop',
    })
  })

  // The system_admin-is-global rule now lives in hasAdminAccessToTenant, which
  // owns it for every admin surface. This page's job is only to delegate, and to
  // delegate with the tenant it actually resolved — not the slug from the URL.
  it('delegates the access decision to hasAdminAccessToTenant with the resolved tenant id', async () => {
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: TENANT_ID } }))
      .mockReturnValueOnce(chain({ data: null }))
    mockUser('user-1', { name: 'Sys' }, fromMock)
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)

    const result = await AdminAccountPage({ params: PARAMS })

    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(findByType(result, AdminAccountForm)).not.toBeNull()
  })
})

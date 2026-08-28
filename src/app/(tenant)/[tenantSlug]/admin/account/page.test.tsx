import { describe, it, expect, vi, beforeEach } from 'vitest'
import AdminAccountPage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import AdminAccountForm from './_components/admin-account-form'
import AccountForm from '@/app/(official)/[tenantSlug]/account/_components/account-form'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

// getAdminTenant resolves the tenant only after the admin access check passes,
// so a null return means either "no such tenant" or "not authorized". Both are
// notFound() to the caller, which is deliberate: an unauthorized caller must not
// be able to probe for tenant existence.
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

// `tenant` carries both outcomes getAdminTenant can produce: a row when the
// caller is an authorized admin of it, or null for "no such tenant OR not
// authorized" — the two are deliberately indistinguishable to the caller.
function mockUser(
  userId: string | null,
  userMetadata: Record<string, unknown> = {},
  fromMock: ReturnType<typeof vi.fn> = vi.fn(),
  tenant: unknown = { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', is_active: true }
) {
  vi.mocked(getCurrentUser).mockResolvedValue(
    (userId ? { id: userId, user_metadata: userMetadata, phone: '0701234567' } : null) as never
  )
  vi.mocked(getAdminTenant).mockResolvedValue(tenant as never)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminAccountPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null)

    await expect(AdminAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(getAdminTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when the user has no admin access to this tenant', async () => {
    // A denied access check and a missing tenant both surface as null.
    mockUser('user-1', {}, vi.fn(), null)

    await expect(AdminAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
  })

  it('calls notFound when the resolved tenant slug does not exist', async () => {
    mockUser('user-1', {}, vi.fn(), null)

    await expect(AdminAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
  })

  it('renders AdminAccountForm with metadata name/phone when no official row exists yet', async () => {
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(chain({ data: null })) // officials — none
    mockUser('user-1', { name: 'Peter' }, fromMock)

    const result = await AdminAccountPage({ params: PARAMS })

    const form = findByType(result, AdminAccountForm)
    expect(form).not.toBeNull()
    expect(form!.props).toEqual({ name: 'Peter', phone: '0701234567', tenantId: TENANT_ID })
  })

  it('renders AccountForm with the official row and assignment count when it exists', async () => {
    const official = { id: 'off-1', name: 'Peter', phone: '0701234567', sms_opt_out: false }
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: official })) // officials
      .mockReturnValueOnce(chain({ count: 3 })) // assignments count
    mockUser('user-1', {}, fromMock)

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

  // The system_admin-is-global rule lives in hasAdminAccessToTenant, reached
  // through getAdminTenant, which owns it for every admin surface. This page's
  // job is only to delegate — and to act on whatever tenant comes back rather
  // than trusting the slug from the URL.
  it('delegates the access decision to getAdminTenant', async () => {
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(chain({ data: null }))
    mockUser('user-1', { name: 'Sys' }, fromMock)

    const result = await AdminAccountPage({ params: PARAMS })

    expect(getAdminTenant).toHaveBeenCalledWith('viadal')
    expect(findByType(result, AdminAccountForm)).not.toBeNull()
  })
})

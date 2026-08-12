import { describe, it, expect, vi, beforeEach } from 'vitest'
import AdminAccountPage from './page'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getUserRoles } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import AdminAccountForm from './_components/admin-account-form'
import AccountForm from '@/app/(official)/[tenantSlug]/account/_components/account-form'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  getUserRoles: vi.fn(),
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

function mockUser(userId: string | null, userMetadata: Record<string, unknown> = {}) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: userId ? { id: userId, user_metadata: userMetadata, phone: '0701234567' } : null,
        },
      }),
    },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminAccountPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null)

    await expect(AdminAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(getUserRoles).not.toHaveBeenCalled()
  })

  it('calls notFound when the user has neither a role in this tenant nor system_admin', async () => {
    mockUser('user-1')
    vi.mocked(getUserRoles).mockResolvedValue([
      { role: 'tenant_admin', tenant_id: 'other-tenant', tenantSlug: 'other' },
    ])

    await expect(AdminAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('calls notFound when the resolved tenant slug does not exist', async () => {
    mockUser('user-1')
    vi.mocked(getUserRoles).mockResolvedValue([
      { role: 'tenant_admin', tenant_id: TENANT_ID, tenantSlug: 'viadal' },
    ])
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(chain({ data: null })),
    } as never)

    await expect(AdminAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders AdminAccountForm with metadata name/phone when no official row exists yet', async () => {
    mockUser('user-1', { name: 'Peter' })
    vi.mocked(getUserRoles).mockResolvedValue([
      { role: 'tenant_admin', tenant_id: TENANT_ID, tenantSlug: 'viadal' },
    ])
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: TENANT_ID } })) // tenants
      .mockReturnValueOnce(chain({ data: null })) // officials — none
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await AdminAccountPage({ params: PARAMS })

    const form = findByType(result, AdminAccountForm)
    expect(form).not.toBeNull()
    expect(form!.props).toEqual({ name: 'Peter', phone: '0701234567', tenantId: TENANT_ID })
  })

  it('renders AccountForm with the official row and assignment count when it exists', async () => {
    mockUser('user-1')
    vi.mocked(getUserRoles).mockResolvedValue([
      { role: 'tenant_admin', tenant_id: TENANT_ID, tenantSlug: 'viadal' },
    ])
    const official = { id: 'off-1', name: 'Peter', phone: '0701234567', sms_opt_out: false }
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: TENANT_ID } })) // tenants
      .mockReturnValueOnce(chain({ data: official })) // officials
      .mockReturnValueOnce(chain({ count: 3 })) // assignments count
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

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

  it('grants access via system_admin even without a tenant-specific role', async () => {
    mockUser('user-1', { name: 'Sys' })
    vi.mocked(getUserRoles).mockResolvedValue([
      { role: 'system_admin', tenant_id: 'system', tenantSlug: '' },
    ])
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: TENANT_ID } }))
      .mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await AdminAccountPage({ params: PARAMS })

    expect(findByType(result, AdminAccountForm)).not.toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import OfficialAccountPage from './page'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AccountForm from './_components/account-form'

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

vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn().mockResolvedValue((key: string) => key),
}))

vi.mock('./_components/account-form', () => ({
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

function mockUser(userId: string | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }) },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OfficialAccountPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null)

    await expect(OfficialAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('calls notFound when the tenant slug does not resolve', async () => {
    mockUser('user-1')
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(chain({ data: null })),
    } as never)

    await expect(OfficialAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('calls notFound when no official row matches this user and tenant', async () => {
    mockUser('user-1')
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: TENANT_ID } })) // tenants
      .mockReturnValueOnce(chain({ data: null })) // officials
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    await expect(OfficialAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('scopes the officials lookup by user_id and tenant_id', async () => {
    mockUser('user-1')
    const officialsBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '0701234567', sms_opt_out: false },
    })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: TENANT_ID } }))
      .mockReturnValueOnce(officialsBuilder)
      .mockReturnValueOnce(chain({ count: 2 }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    await OfficialAccountPage({ params: PARAMS })

    expect(officialsBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(officialsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('renders AccountForm with the official row and assignment count', async () => {
    mockUser('user-1')
    const official = { id: 'off-1', name: 'Anna', phone: '0701234567', sms_opt_out: true }
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: TENANT_ID } }))
      .mockReturnValueOnce(chain({ data: official }))
      .mockReturnValueOnce(chain({ count: 5 }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await OfficialAccountPage({ params: PARAMS })

    const form = findByType(result, AccountForm)
    expect(form).not.toBeNull()
    expect(form!.props).toEqual({
      name: 'Anna',
      phone: '0701234567',
      smsOptOut: true,
      tenantId: TENANT_ID,
      tenantSlug: 'viadal',
      assignmentCount: 5,
      i18nNamespace: 'official',
    })
  })

  it('defaults assignmentCount to 0 when the count is null', async () => {
    mockUser('user-1')
    const official = { id: 'off-1', name: 'Anna', phone: '0701234567', sms_opt_out: false }
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: { id: TENANT_ID } }))
      .mockReturnValueOnce(chain({ data: official }))
      .mockReturnValueOnce(chain({ count: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await OfficialAccountPage({ params: PARAMS })

    const form = findByType(result, AccountForm)
    expect(form!.props.assignmentCount).toBe(0)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import TenantDetailPage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { TenantDetail } from './_components/tenant-detail'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('./_components/tenant-detail', () => ({
  TenantDetail: vi.fn(() => null),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  return builder
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
})

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

describe('TenantDetailPage', () => {
  it('calls notFound and renders nothing when the tenant does not exist', async () => {
    const fromMock = vi.fn().mockReturnValue(chain({ data: null }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    await expect(
      TenantDetailPage({ params: Promise.resolve({ tenantId: TENANT_ID }) })
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
  })

  it('queries the tenant by id and renders TenantDetail with its fields', async () => {
    const tenant = { id: TENANT_ID, name: 'Viadal', is_active: true, tier: 'premium' }
    const tenantsBuilder = chain({ data: tenant })
    const fromMock = vi.fn().mockReturnValue(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const result = await TenantDetailPage({ params: Promise.resolve({ tenantId: TENANT_ID }) })

    expect(fromMock).toHaveBeenCalledWith('tenants')
    expect(tenantsBuilder.eq).toHaveBeenCalledWith('id', TENANT_ID)

    const detail = findByType(result, TenantDetail)
    expect(detail).not.toBeNull()
    expect(detail!.props).toEqual({
      tenantId: TENANT_ID,
      isActive: true,
      tier: 'premium',
    })
  })
})

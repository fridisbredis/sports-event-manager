import { describe, it, expect, vi, beforeEach } from 'vitest'
import SystemAdminPage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { notFound } from 'next/navigation'
import { logger } from '@/lib/logger'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  requireSystemAdmin: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('./_components/tenant-list', () => ({
  TenantList: (props: unknown) => ({ type: 'TenantList', props }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.range = vi.fn(() => Promise.resolve(result))
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSystemAdmin).mockResolvedValue({ user: { id: 'user-1' } } as never)
})

describe('SystemAdminPage', () => {
  it('calls notFound when the caller is not a system admin', async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue({ error: {} } as never)

    await expect(SystemAdminPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it('queries tenants ordered by newest first and passes them to TenantList', async () => {
    const tenants = [
      { id: 't-1', name: 'Viadal', slug: 'viadal', is_active: true, tier: 'standard' },
    ]
    const tenantsBuilder = chain({ data: tenants })
    const fromMock = vi.fn().mockReturnValue(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const result = await SystemAdminPage()

    expect(fromMock).toHaveBeenCalledWith('tenants')
    expect(tenantsBuilder.select).toHaveBeenCalledWith('id, name, slug, is_active, tier')
    expect(tenantsBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(result.props).toEqual({ tenants })
  })

  it('bounds the read, asking for one row past the ceiling (PERF-06)', async () => {
    const tenantsBuilder = chain({ data: [] })
    const fromMock = vi.fn().mockReturnValue(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    await SystemAdminPage()

    // 501 rows requested for a 500 ceiling: the extra row is what makes a
    // breach detectable instead of a silent truncation.
    expect(tenantsBuilder.range).toHaveBeenCalledWith(0, 500)
  })

  it('warns and truncates to the ceiling when the ceiling is breached', async () => {
    const overflow = Array.from({ length: 501 }, (_, i) => ({
      id: `t-${i}`,
      name: `Tenant ${i}`,
      slug: `tenant-${i}`,
      is_active: true,
      tier: 'standard',
    }))
    const tenantsBuilder = chain({ data: overflow })
    const fromMock = vi.fn().mockReturnValue(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const result = await SystemAdminPage()

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('read ceiling'),
      expect.objectContaining({ ceiling: 500, page: '(system)/admin' })
    )
    expect(result.props.tenants).toHaveLength(500)
  })

  it('does not warn when the row count sits exactly on the ceiling', async () => {
    const atCeiling = Array.from({ length: 500 }, (_, i) => ({
      id: `t-${i}`,
      name: `Tenant ${i}`,
      slug: `tenant-${i}`,
      is_active: true,
      tier: 'standard',
    }))
    const tenantsBuilder = chain({ data: atCeiling })
    const fromMock = vi.fn().mockReturnValue(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const result = await SystemAdminPage()

    expect(logger.warn).not.toHaveBeenCalled()
    expect(result.props.tenants).toHaveLength(500)
  })

  it('passes an empty array when the query returns no data', async () => {
    const tenantsBuilder = chain({ data: null })
    const fromMock = vi.fn().mockReturnValue(tenantsBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const result = await SystemAdminPage()

    expect(result.props).toEqual({ tenants: [] })
  })
})

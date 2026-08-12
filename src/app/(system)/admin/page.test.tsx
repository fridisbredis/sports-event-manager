import { describe, it, expect, vi, beforeEach } from 'vitest'
import SystemAdminPage from './page'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('./_components/tenant-list', () => ({
  TenantList: (props: unknown) => ({ type: 'TenantList', props }),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.order = vi.fn(() => Promise.resolve(result))
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SystemAdminPage', () => {
  it('queries tenants ordered by newest first and passes them to TenantList', async () => {
    const tenants = [
      { id: 't-1', name: 'Viadal', slug: 'viadal', is_active: true, tier: 'standard' },
    ]
    const tenantsBuilder = chain({ data: tenants })
    const fromMock = vi.fn().mockReturnValue(tenantsBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await SystemAdminPage()

    expect(fromMock).toHaveBeenCalledWith('tenants')
    expect(tenantsBuilder.select).toHaveBeenCalledWith('id, name, slug, is_active, tier')
    expect(tenantsBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(result.props).toEqual({ tenants })
  })

  it('passes an empty array when the query returns no data', async () => {
    const tenantsBuilder = chain({ data: null })
    const fromMock = vi.fn().mockReturnValue(tenantsBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await SystemAdminPage()

    expect(result.props).toEqual({ tenants: [] })
  })
})

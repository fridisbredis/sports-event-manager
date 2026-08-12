import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTenant, setTenantActive, setTenantTier } from './actions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'insert', 'update', 'eq', 'limit']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockAuthedSystemAdmin(fromMock: ReturnType<typeof vi.fn>) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
  } as never)
  // First from() call inside assertSystemAdmin resolves the role check.
  fromMock.mockReturnValueOnce(chain({ data: { role: 'system_admin' } }))
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertSystemAdmin gate (shared by all actions)', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)

    await expect(createTenant('Viadal 2026')).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('returns Forbidden and never touches tenants when the user is not a system_admin', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    } as never)
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await createTenant('Viadal 2026')

    expect(result).toEqual({ error: 'Forbidden' })
    expect(fromMock).toHaveBeenCalledTimes(1)
  })
})

describe('createTenant', () => {
  it('rejects a blank name without querying tenants', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await createTenant('   ')

    expect(result).toEqual({ error: 'Invalid name' })
    // Only the assertSystemAdmin role lookup happened — no tenant insert.
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('creates the tenant, default event, and default stages, then revalidates /admin', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    fromMock
      .mockReturnValueOnce(chain({ data: { id: 'tenant-1' }, error: null })) // tenants insert
      .mockReturnValueOnce(chain({ data: { id: 'event-1' }, error: null })) // events insert
      .mockReturnValueOnce(chain({ error: null })) // event_stages insert
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await createTenant('  Viadal 2026  ')

    expect(result).toEqual({})
    const tenantsBuilder = fromMock.mock.results[1].value
    expect(tenantsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Viadal 2026', slug: 'viadal-2026', is_active: true })
    )
    const eventsBuilder = fromMock.mock.results[2].value
    expect(eventsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant-1', name: 'Viadal 2026' })
    )
    expect(revalidatePath).toHaveBeenCalledWith('/admin')
  })

  it('returns a friendly error on a duplicate tenant name (unique violation)', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    fromMock.mockReturnValueOnce(chain({ data: null, error: { code: '23505' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await createTenant('Viadal 2026')

    expect(result).toEqual({ error: 'A tenant with that name already exists' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('setTenantActive', () => {
  it('rejects a non-uuid tenantId without writing to tenants', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await setTenantActive('not-a-uuid', true)

    expect(result).toEqual({ error: 'Invalid request' })
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('updates is_active and revalidates both admin paths', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    const updateBuilder = chain({ error: null })
    fromMock.mockReturnValueOnce(updateBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await setTenantActive(TENANT_ID, false)

    expect(result).toEqual({})
    expect(updateBuilder.update).toHaveBeenCalledWith({ is_active: false })
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', TENANT_ID)
    expect(revalidatePath).toHaveBeenCalledWith('/admin')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/' + TENANT_ID)
  })

  it('returns an error and skips revalidation when the update fails', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    fromMock.mockReturnValueOnce(chain({ error: { message: 'db is down' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await setTenantActive(TENANT_ID, true)

    expect(result).toEqual({ error: 'Failed to update tenant' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('setTenantTier', () => {
  it('rejects an invalid tier value without writing to tenants', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await setTenantTier(TENANT_ID, 'enterprise' as never)

    expect(result).toEqual({ error: 'Invalid request' })
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-uuid tenantId', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await setTenantTier('not-a-uuid', 'premium')

    expect(result).toEqual({ error: 'Invalid request' })
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('updates the tier and revalidates the tenant detail path', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    const updateBuilder = chain({ error: null })
    fromMock.mockReturnValueOnce(updateBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await setTenantTier(TENANT_ID, 'premium')

    expect(result).toEqual({})
    expect(updateBuilder.update).toHaveBeenCalledWith({ tier: 'premium' })
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', TENANT_ID)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/' + TENANT_ID)
  })

  it('returns an error and skips revalidation when the update fails', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    fromMock.mockReturnValueOnce(chain({ error: { message: 'db is down' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const result = await setTenantTier(TENANT_ID, 'premium')

    expect(result).toEqual({ error: 'Failed to update tier' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

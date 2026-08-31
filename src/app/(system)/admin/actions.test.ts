import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTenant, setTenantActive, setTenantTier } from './actions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log-audit-event'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/audit/log-audit-event', () => ({
  logAuditEvent: vi.fn(),
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

// assertSystemAdmin's role lookup goes through createSupabaseServiceClient
// (bootstrap lookup — see the comment in actions.ts); every write after
// that check passes goes through createSupabaseServerClient (RLS-enforced),
// so the two clients need independent from() mocks.
function mockAuthedSystemAdmin(serverFromMock: ReturnType<typeof vi.fn>) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
    from: serverFromMock,
  } as never)
  vi.mocked(createSupabaseServiceClient).mockResolvedValue({
    from: vi.fn().mockReturnValueOnce(chain({ data: { role: 'system_admin' } })),
  } as never)
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
    const serverFromMock = vi.fn()
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: serverFromMock,
    } as never)
    const serviceFromMock = vi.fn().mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockResolvedValue({ from: serviceFromMock } as never)

    const result = await createTenant('Viadal 2026')

    expect(result).toEqual({ error: 'Forbidden' })
    expect(serviceFromMock).toHaveBeenCalledTimes(1)
    expect(serverFromMock).not.toHaveBeenCalled()
  })
})

describe('createTenant', () => {
  it('rejects a blank name without querying tenants', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)

    const result = await createTenant('   ')

    expect(result).toEqual({ error: 'Invalid name' })
    // assertSystemAdmin's role lookup goes through the service client, not this one.
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('creates the tenant, default event, and default stages, then revalidates /admin', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    fromMock
      .mockReturnValueOnce(chain({ data: { id: 'tenant-1' }, error: null })) // tenants insert
      .mockReturnValueOnce(chain({ data: { id: 'event-1' }, error: null })) // events insert
      .mockReturnValueOnce(chain({ error: null })) // event_stages insert

    const result = await createTenant('  Viadal 2026  ')

    expect(result).toEqual({})
    const tenantsBuilder = fromMock.mock.results[0].value
    expect(tenantsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Viadal 2026', slug: 'viadal-2026', is_active: true })
    )
    const eventsBuilder = fromMock.mock.results[1].value
    expect(eventsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant-1', name: 'Viadal 2026' })
    )
    expect(revalidatePath).toHaveBeenCalledWith('/admin')
    // SEC-07
    expect(logAuditEvent).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorUserId: 'admin-1',
      actorRole: 'system_admin',
      action: 'tenant_created',
      targetType: 'tenant',
      targetId: 'tenant-1',
      detail: { name: 'Viadal 2026', slug: 'viadal-2026' },
    })
  })

  it('returns a friendly error on a duplicate tenant name (unique violation)', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    fromMock.mockReturnValueOnce(chain({ data: null, error: { code: '23505' } }))

    const result = await createTenant('Viadal 2026')

    expect(result).toEqual({ error: 'A tenant with that name already exists' })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})

describe('setTenantActive', () => {
  it('rejects a non-uuid tenantId without writing to tenants', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)

    const result = await setTenantActive('not-a-uuid', true)

    expect(result).toEqual({ error: 'Invalid request' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('updates is_active and revalidates both admin paths', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    const updateBuilder = chain({ error: null })
    fromMock.mockReturnValueOnce(updateBuilder)

    const result = await setTenantActive(TENANT_ID, false)

    expect(result).toEqual({})
    expect(updateBuilder.update).toHaveBeenCalledWith({ is_active: false })
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', TENANT_ID)
    expect(revalidatePath).toHaveBeenCalledWith('/admin')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/' + TENANT_ID)
    // SEC-07
    expect(logAuditEvent).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: 'admin-1',
      actorRole: 'system_admin',
      action: 'tenant_deactivated',
      targetType: 'tenant',
      targetId: TENANT_ID,
      detail: { isActive: false },
    })
  })

  it('returns an error and skips revalidation when the update fails', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    fromMock.mockReturnValueOnce(chain({ error: { message: 'db is down' } }))

    const result = await setTenantActive(TENANT_ID, true)

    expect(result).toEqual({ error: 'Failed to update tenant' })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})

describe('setTenantTier', () => {
  it('rejects an invalid tier value without writing to tenants', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)

    const result = await setTenantTier(TENANT_ID, 'enterprise' as never)

    expect(result).toEqual({ error: 'Invalid request' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('rejects a non-uuid tenantId', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)

    const result = await setTenantTier('not-a-uuid', 'premium')

    expect(result).toEqual({ error: 'Invalid request' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('updates the tier and revalidates the tenant detail path', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    const updateBuilder = chain({ error: null })
    fromMock.mockReturnValueOnce(updateBuilder)

    const result = await setTenantTier(TENANT_ID, 'premium')

    expect(result).toEqual({})
    expect(updateBuilder.update).toHaveBeenCalledWith({ tier: 'premium' })
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', TENANT_ID)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/' + TENANT_ID)
    // SEC-07
    expect(logAuditEvent).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: 'admin-1',
      actorRole: 'system_admin',
      action: 'tenant_tier_changed',
      targetType: 'tenant',
      targetId: TENANT_ID,
      detail: { tier: 'premium' },
    })
  })

  it('returns an error and skips revalidation when the update fails', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    fromMock.mockReturnValueOnce(chain({ error: { message: 'db is down' } }))

    const result = await setTenantTier(TENANT_ID, 'premium')

    expect(result).toEqual({ error: 'Failed to update tier' })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})

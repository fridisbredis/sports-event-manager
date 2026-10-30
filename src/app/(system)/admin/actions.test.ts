import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createTenant,
  setTenantActive,
  setTenantTier,
  setTenantSmsSenderId,
  grantSystemAdmin,
  revokeSystemAdmin,
  updateOwnSystemAdminName,
} from './actions'
import { grantSystemAdminRole, revokeSystemAdminRole } from '@/lib/auth/system-admins'
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

// N28: the RPC and audit behaviour is covered in system-admins.test.ts; here
// only what the actions add on top — the gate, validation, self-removal.
vi.mock('@/lib/auth/system-admins', () => ({
  grantSystemAdminRole: vi.fn(),
  revokeSystemAdminRole: vi.fn(),
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
// so the two clients need independent from()/rpc() mocks.
function mockAuthedSystemAdmin(
  serverFromMock: ReturnType<typeof vi.fn>,
  rpcMock: ReturnType<typeof vi.fn> = vi.fn()
) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
    from: serverFromMock,
    rpc: rpcMock,
  } as never)
  // create_tenant_with_defaults became SECURITY DEFINER / service_role-only in
  // migration 20261015124237, so createTenant calls it through the service
  // client — which also creates the first admin's auth user. The same rpc mock
  // backs both clients so a test can assert on one object.
  vi.mocked(createSupabaseServiceClient).mockResolvedValue({
    from: vi.fn().mockReturnValueOnce(chain({ data: { role: 'system_admin' } })),
    rpc: rpcMock,
    auth: {
      admin: {
        createUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'admin-user-1' } }, error: null }),
        getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: {} } } }),
        updateUserById: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  } as never)
}

// N20: every tenant is created with its first admin, so the three admin
// arguments are part of the call now.
const ADMIN_ARGS = ['Peter Thörn', '709900001', 'SE'] as const

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertSystemAdmin gate (shared by all actions)', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)

    await expect(createTenant('Viadal 2026', ...ADMIN_ARGS)).rejects.toThrow('NEXT_REDIRECT')
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

    const result = await createTenant('Viadal 2026', ...ADMIN_ARGS)

    expect(result).toEqual({ error: 'Not authorized' })
    expect(serviceFromMock).toHaveBeenCalledTimes(1)
    expect(serverFromMock).not.toHaveBeenCalled()
  })
})

describe('createTenant', () => {
  it('rejects a blank name without querying tenants', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)

    const result = await createTenant('   ', ...ADMIN_ARGS)

    expect(result).toEqual({ error: 'Invalid name' })
    // assertSystemAdmin's role lookup goes through the service client, not this one.
    expect(fromMock).not.toHaveBeenCalled()
  })

  // REL-01: tenant/event/stages are now created atomically by the
  // create_tenant_with_defaults RPC (migration 20260908130253) instead of
  // three separate .insert() calls — see
  // tests/integration/create-tenant-atomicity.test.ts for the real-Postgres
  // proof that a partial failure rolls back all three tables. This unit
  // test only proves the call site passes the right args and handles the
  // RPC's response shape correctly.
  it('creates the tenant via the atomic RPC, then revalidates /admin', async () => {
    const fromMock = vi.fn()
    const rpcMock = vi.fn().mockResolvedValue({
      data: { tenant_id: 'tenant-1', event_id: 'event-1' },
      error: null,
    })
    mockAuthedSystemAdmin(fromMock, rpcMock)

    const result = await createTenant('  Viadal 2026  ', ...ADMIN_ARGS)

    expect(result).toEqual({})
    expect(rpcMock).toHaveBeenCalledWith('create_tenant_with_defaults', {
      p_name: 'Viadal 2026',
      p_slug: 'viadal-2026',
      p_admin_user_id: 'admin-user-1',
      p_admin_name: 'Peter Thörn',
    })
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
    // N20: the first admin is a privilege grant and is logged as one, so the
    // only record of who can administer a new tenant is not the role row alone.
    expect(logAuditEvent).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorUserId: 'admin-1',
      actorRole: 'system_admin',
      action: 'tenant_admin_granted',
      targetType: 'user_role',
      targetId: 'admin-user-1',
      detail: { firstAdmin: true },
    })
  })

  it('refuses to create a tenant without a first admin', async () => {
    // The whole point of N20's second half: a tenant with no admin row cannot
    // be signed in to, which is how two of the three tenants in prod ended up
    // unreachable. The RPC is never reached.
    const rpcMock = vi.fn()

    // mockAuthedSystemAdmin's role lookup is mockReturnValueOnce, so it is
    // re-armed per call rather than shared across the two assertions.
    mockAuthedSystemAdmin(vi.fn(), rpcMock)
    expect(await createTenant('Viadal 2026', '', '709900001', 'SE')).toEqual({
      error: 'Invalid name',
    })

    mockAuthedSystemAdmin(vi.fn(), rpcMock)
    expect(await createTenant('Viadal 2026', 'Peter Thörn', '', 'SE')).toEqual({
      error: 'Invalid name',
    })

    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rejects a phone number that is not valid for the chosen country', async () => {
    const fromMock = vi.fn()
    const rpcMock = vi.fn()
    mockAuthedSystemAdmin(fromMock, rpcMock)

    const result = await createTenant('Viadal 2026', 'Peter Thörn', '123', 'SE')

    expect(result).toEqual({ error: 'Invalid phone number for the selected country' })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('reuses an existing account when the admin phone already has one', async () => {
    // Promoting someone who is already an official elsewhere is the normal
    // case; createUser answers phone_exists and the id comes from the lookup.
    const rpcMock = vi.fn((fn: string) =>
      fn === 'get_user_id_by_phone'
        ? Promise.resolve({ data: 'existing-user-1', error: null })
        : Promise.resolve({
            data: { tenant_id: 'tenant-1', event_id: 'event-1' },
            error: null,
          })
    )
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
      from: vi.fn(),
      rpc: rpcMock,
    } as never)
    vi.mocked(createSupabaseServiceClient).mockResolvedValue({
      from: vi.fn().mockReturnValueOnce(chain({ data: { role: 'system_admin' } })),
      rpc: rpcMock,
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValue({ data: null, error: { code: 'phone_exists' } }),
          getUserById: vi
            .fn()
            .mockResolvedValue({ data: { user: { user_metadata: { name: 'Peter' } } } }),
          updateUserById: vi.fn().mockResolvedValue({ error: null }),
        },
      },
    } as never)

    const result = await createTenant('Viadal 2026', 'Peter Thörn', '709900001', 'SE')

    expect(result).toEqual({})
    expect(rpcMock).toHaveBeenCalledWith(
      'create_tenant_with_defaults',
      expect.objectContaining({ p_admin_user_id: 'existing-user-1' })
    )
  })

  it('returns a friendly error on a duplicate tenant name (unique violation)', async () => {
    const fromMock = vi.fn()
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { code: '23505' } })
    mockAuthedSystemAdmin(fromMock, rpcMock)

    const result = await createTenant('Viadal 2026', ...ADMIN_ARGS)

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

describe('setTenantSmsSenderId (N13)', () => {
  it('rejects a name Twilio would refuse, without writing', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)

    const result = await setTenantSmsSenderId(TENANT_ID, 'Viadal2026xx')

    expect(result.error).toBeDefined()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('saves a trimmed name, audits it and revalidates the tenant page', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    const updateBuilder = chain({ error: null })
    fromMock.mockReturnValueOnce(updateBuilder)

    const result = await setTenantSmsSenderId(TENANT_ID, '  Viadal ')

    expect(result).toEqual({})
    expect(updateBuilder.update).toHaveBeenCalledWith({ sms_sender_id: 'Viadal' })
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', TENANT_ID)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/' + TENANT_ID)
    expect(logAuditEvent).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: 'admin-1',
      actorRole: 'system_admin',
      action: 'tenant_sms_sender_changed',
      targetType: 'tenant',
      targetId: TENANT_ID,
      detail: { smsSenderId: 'Viadal' },
    })
  })

  // Clearing is how a tenant goes back to the platform number.
  it('clears the name when given an empty value', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    const updateBuilder = chain({ error: null })
    fromMock.mockReturnValueOnce(updateBuilder)

    await setTenantSmsSenderId(TENANT_ID, '')

    expect(updateBuilder.update).toHaveBeenCalledWith({ sms_sender_id: null })
  })

  it('returns an error and skips the audit when the update fails', async () => {
    const fromMock = vi.fn()
    mockAuthedSystemAdmin(fromMock)
    fromMock.mockReturnValueOnce(chain({ error: { message: 'db is down' } }))

    const result = await setTenantSmsSenderId(TENANT_ID, 'Viadal')

    expect(result).toEqual({ error: 'Failed to update the SMS sender' })
    expect(logAuditEvent).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('grantSystemAdmin (N28)', () => {
  it('refuses a caller who is not a system admin', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    } as never)
    vi.mocked(createSupabaseServiceClient).mockResolvedValue({
      from: vi.fn().mockReturnValueOnce(chain({ data: null })),
    } as never)

    const result = await grantSystemAdmin(...ADMIN_ARGS)

    expect(result.error).toBeDefined()
    expect(grantSystemAdminRole).not.toHaveBeenCalled()
  })

  it('rejects a phone number that is not valid for the chosen country', async () => {
    mockAuthedSystemAdmin(vi.fn())

    const result = await grantSystemAdmin('Peter Thörn', '123', 'SE')

    expect(result.error).toBeDefined()
    expect(grantSystemAdminRole).not.toHaveBeenCalled()
  })

  it('resolves the auth user by phone, grants as the caller, and revalidates the list', async () => {
    mockAuthedSystemAdmin(vi.fn())
    vi.mocked(grantSystemAdminRole).mockResolvedValue({ ok: true })

    expect(await grantSystemAdmin(...ADMIN_ARGS)).toEqual({})
    expect(grantSystemAdminRole).toHaveBeenCalledWith('admin-user-1', 'admin-1')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/system-admins')
  })

  it('returns an error and skips revalidation when the grant fails', async () => {
    mockAuthedSystemAdmin(vi.fn())
    vi.mocked(grantSystemAdminRole).mockResolvedValue({ ok: false, reason: 'failed' })

    const result = await grantSystemAdmin(...ADMIN_ARGS)

    expect(result.error).toBeDefined()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('revokeSystemAdmin (N28)', () => {
  const TARGET = '22222222-2222-2222-2222-222222222222'

  it('rejects a non-uuid user id', async () => {
    mockAuthedSystemAdmin(vi.fn())

    expect((await revokeSystemAdmin('not-a-uuid')).error).toBeDefined()
    expect(revokeSystemAdminRole).not.toHaveBeenCalled()
  })

  it('refuses to let a system admin remove themselves', async () => {
    const self = '33333333-3333-3333-3333-333333333333'
    mockAuthedSystemAdmin(vi.fn())
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: self } } }) },
    } as never)

    const result = await revokeSystemAdmin(self)

    expect(result.error).toBe('You cannot change your own admin role.')
    expect(revokeSystemAdminRole).not.toHaveBeenCalled()
  })

  it('revokes as the caller and revalidates the list', async () => {
    mockAuthedSystemAdmin(vi.fn())
    vi.mocked(revokeSystemAdminRole).mockResolvedValue({ ok: true })

    expect(await revokeSystemAdmin(TARGET)).toEqual({})
    expect(revokeSystemAdminRole).toHaveBeenCalledWith(TARGET, 'admin-1')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/system-admins')
  })

  it('explains the last-admin guard', async () => {
    mockAuthedSystemAdmin(vi.fn())
    vi.mocked(revokeSystemAdminRole).mockResolvedValue({ ok: false, reason: 'lastAdmin' })

    expect((await revokeSystemAdmin(TARGET)).error).toBe(
      'This is the last system admin. There must always be at least one.'
    )
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('updateOwnSystemAdminName (N28)', () => {
  it('refuses a caller who is not a system admin', async () => {
    const updateUserById = vi.fn()
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    } as never)
    vi.mocked(createSupabaseServiceClient).mockResolvedValue({
      from: vi.fn().mockReturnValueOnce(chain({ data: null })),
      auth: { admin: { updateUserById } },
    } as never)

    const result = await updateOwnSystemAdminName('Frida Bredberg')

    expect(result.error).toBeDefined()
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('rejects a blank name', async () => {
    mockAuthedSystemAdmin(vi.fn())
    const service = await createSupabaseServiceClient()

    expect((await updateOwnSystemAdminName('   ')).error).toBeDefined()
    expect(service.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it("writes the trimmed name to the caller's own metadata and revalidates", async () => {
    mockAuthedSystemAdmin(vi.fn())
    const service = await createSupabaseServiceClient()

    expect(await updateOwnSystemAdminName('  Peter Thörn ')).toEqual({})
    expect(service.auth.admin.updateUserById).toHaveBeenCalledWith('admin-1', {
      user_metadata: { name: 'Peter Thörn' },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/system-admins')
  })

  it('returns an error and skips revalidation when the update fails', async () => {
    mockAuthedSystemAdmin(vi.fn())
    const service = await createSupabaseServiceClient()
    vi.mocked(service.auth.admin.updateUserById).mockResolvedValueOnce({
      error: new Error('boom'),
    } as never)

    expect((await updateOwnSystemAdminName('Peter Thörn')).error).toBe(
      'Could not save your name. Try again.'
    )
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

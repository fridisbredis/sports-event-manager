import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listTenantAdmins, isAdminWithinCap, remainingAdminSlots } from './tenant-admins'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'range', 'in']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockService(responses: Record<string, unknown>) {
  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    from: vi.fn((table: string) => chain(responses[table])),
  } as never)
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

// Oldest first — the order the cap depends on.
const THREE_ADMINS = [
  { id: 'r1', user_id: 'u1', created_at: '2026-07-07T13:33:47Z' },
  { id: 'r2', user_id: 'u2', created_at: '2026-07-07T13:34:08Z' },
  { id: 'r3', user_id: 'u3', created_at: '2026-09-28T11:26:36Z' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listTenantAdmins', () => {
  it('returns admins oldest first, with roster name and phone attached', async () => {
    mockService({
      user_roles: { data: THREE_ADMINS, error: null },
      officials: {
        data: [
          { user_id: 'u2', name: 'Lotta', phone: '46709356595' },
          { user_id: 'u1', name: 'Peter', phone: '46703021113' },
        ],
        error: null,
      },
    })

    const admins = await listTenantAdmins(TENANT_ID, 'professional')

    expect(admins.map((a) => a.userId)).toEqual(['u1', 'u2', 'u3'])
    expect(admins[0]).toMatchObject({ name: 'Peter', phone: '46703021113' })
    expect(admins[1]).toMatchObject({ name: 'Lotta' })
  })

  it('leaves name and phone null for an admin with no roster row', async () => {
    mockService({
      user_roles: { data: THREE_ADMINS, error: null },
      officials: { data: [], error: null },
    })

    const admins = await listTenantAdmins(TENANT_ID, 'professional')

    expect(admins[2]).toMatchObject({ userId: 'u3', name: null, phone: null })
  })

  it('marks nobody as locked out while the tenant is within its cap', async () => {
    mockService({
      user_roles: { data: THREE_ADMINS, error: null },
      officials: { data: [], error: null },
    })

    const admins = await listTenantAdmins(TENANT_ID, 'professional') // cap 10

    expect(admins.every((a) => !a.lockedOut)).toBe(true)
  })

  it('locks out everyone past the cap, keeping the earliest — the downgrade rule', async () => {
    mockService({
      user_roles: { data: THREE_ADMINS, error: null },
      officials: { data: [], error: null },
    })

    const admins = await listTenantAdmins(TENANT_ID, 'standard') // cap 1

    expect(admins.map((a) => a.lockedOut)).toEqual([false, true, true])
  })

  it('admits exactly the cap on premium', async () => {
    mockService({
      user_roles: { data: THREE_ADMINS, error: null },
      officials: { data: [], error: null },
    })

    const admins = await listTenantAdmins(TENANT_ID, 'premium') // cap 3

    expect(admins.every((a) => !a.lockedOut)).toBe(true)
  })

  it('still lists the admins when the roster lookup fails, rather than hiding them', async () => {
    // The cap and the locked-out state come from the role rows, so a failed
    // roster read must degrade to ids rather than returning nothing — the
    // over-cap state has to stay visible in the screen meant to resolve it.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockService({
      user_roles: { data: THREE_ADMINS, error: null },
      officials: { data: null, error: { message: 'boom' } },
    })

    const admins = await listTenantAdmins(TENANT_ID, 'standard')

    expect(admins).toHaveLength(3)
    expect(admins[0].name).toBeNull()
    expect(admins.map((a) => a.lockedOut)).toEqual([false, true, true])
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('returns an empty list and logs when the role query errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockService({ user_roles: { data: null, error: { message: 'boom' } } })

    expect(await listTenantAdmins(TENANT_ID, 'professional')).toEqual([])
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('returns an empty list for a tenant with no admins, without a roster query', async () => {
    // The unusable-tenant case: SYS-01 creates tenants with no admin row at
    // all, so this is the shape the screen must render.
    const from = vi.fn((table: string) =>
      chain(table === 'user_roles' ? { data: [], error: null } : undefined)
    )
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never)

    expect(await listTenantAdmins(TENANT_ID, 'professional')).toEqual([])
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('falls back to the lowest cap on an unrecognised tier rather than granting none', async () => {
    mockService({
      user_roles: { data: THREE_ADMINS, error: null },
      officials: { data: [], error: null },
    })

    const admins = await listTenantAdmins(TENANT_ID, 'enterprise')

    expect(admins.map((a) => a.lockedOut)).toEqual([false, true, true])
  })
})

describe('isAdminWithinCap', () => {
  beforeEach(() => {
    mockService({
      user_roles: { data: THREE_ADMINS, error: null },
      officials: { data: [], error: null },
    })
  })

  it('admits an admin inside the cap', async () => {
    expect(await isAdminWithinCap('u1', TENANT_ID, 'standard')).toBe(true)
  })

  it('refuses an admin past the cap', async () => {
    expect(await isAdminWithinCap('u2', TENANT_ID, 'standard')).toBe(false)
    expect(await isAdminWithinCap('u3', TENANT_ID, 'standard')).toBe(false)
  })

  it('admits the same admin once the tier is raised', async () => {
    expect(await isAdminWithinCap('u3', TENANT_ID, 'professional')).toBe(true)
  })

  it('refuses a user who holds no admin row at all', async () => {
    expect(await isAdminWithinCap('stranger', TENANT_ID, 'professional')).toBe(false)
  })
})

describe('remainingAdminSlots', () => {
  it('reports the slots left on each tier', () => {
    expect(remainingAdminSlots(0, 'standard')).toBe(1)
    expect(remainingAdminSlots(1, 'premium')).toBe(2)
    expect(remainingAdminSlots(3, 'professional')).toBe(7)
  })

  it('never reports negative room for a tenant already over its cap', () => {
    expect(remainingAdminSlots(3, 'standard')).toBe(0)
  })
})

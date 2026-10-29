import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

import { makeTenantAdmin, removeTenantAdmin, addOfficialsToEvent } from './actions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTenantAdmin, getAdminTenant } from '@/lib/auth/tenant'
import {
  resolveAdminAuthUser,
  grantTenantAdminRole,
  revokeTenantAdminRole,
} from '@/lib/auth/tenant-admins'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  requireTenantAdmin: vi.fn(),
  getAdminTenant: vi.fn(),
}))

vi.mock('@/lib/auth/tenant-admins', () => ({
  resolveAdminAuthUser: vi.fn(),
  grantTenantAdminRole: vi.fn(),
  revokeTenantAdminRole: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Returns the key, so assertions name the key rather than its English text.
vi.mock('@/lib/actions/action-error', () => ({
  translateActionError: vi.fn(async (key: string) => key),
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const OFFICIAL_ID = '22222222-2222-2222-2222-222222222222'
const CALLER_ID = 'caller-user'
const TARGET_ID = 'target-user'

const input = { tenantSlug: 'acme', tenantId: TENANT_ID, officialId: OFFICIAL_ID }

/** An officials query that resolves to `result`, recording its filters. */
function mockOfficialLookup(result: unknown) {
  const eq = vi.fn()
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: eq.mockImplementation(() => builder),
    neq: eq.mockImplementation(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  }
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    from: vi.fn(() => builder),
  } as never)
  return eq
}

function mockCaller(role: 'tenant_admin' | 'system_admin' = 'tenant_admin') {
  vi.mocked(requireTenantAdmin).mockResolvedValue({
    user: { id: CALLER_ID },
    role,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('makeTenantAdmin', () => {
  it('promotes a confirmed official of this tenant and refreshes the roster', async () => {
    mockCaller()
    const eq = mockOfficialLookup({
      data: { user_id: TARGET_ID, invite_status: 'confirmed' },
      error: null,
    })
    vi.mocked(grantTenantAdminRole).mockResolvedValue({ ok: true })

    expect(await makeTenantAdmin(input)).toEqual({})

    // The official is resolved within this tenant, and only if still on the
    // roster — the client never names a user id.
    expect(eq).toHaveBeenCalledWith('id', OFFICIAL_ID)
    expect(eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(eq).toHaveBeenCalledWith('invite_status', 'removed')
    expect(resolveAdminAuthUser).not.toHaveBeenCalled()
    expect(grantTenantAdminRole).toHaveBeenCalledWith(TENANT_ID, TARGET_ID, {
      userId: CALLER_ID,
      role: 'tenant_admin',
    })
    expect(revalidatePath).toHaveBeenCalledWith(
      '/[tenantSlug]/admin/events/[eventId]/officials',
      'page'
    )
  })

  it('audits a system admin acting from OFF-01 as a system admin', async () => {
    mockCaller('system_admin')
    mockOfficialLookup({ data: { user_id: TARGET_ID, invite_status: 'confirmed' }, error: null })
    vi.mocked(grantTenantAdminRole).mockResolvedValue({ ok: true })

    await makeTenantAdmin(input)

    expect(grantTenantAdminRole).toHaveBeenCalledWith(TENANT_ID, TARGET_ID, {
      userId: CALLER_ID,
      role: 'system_admin',
    })
  })

  it('rejects malformed input before checking anything else', async () => {
    expect(await makeTenantAdmin({ ...input, officialId: 'not-a-uuid' })).toEqual({
      error: 'actionErrors.invalidRequest',
    })
    expect(requireTenantAdmin).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not an admin of this tenant', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    })

    expect(await makeTenantAdmin(input)).toEqual({ error: 'actionErrors.notAuthorized' })
    expect(grantTenantAdminRole).not.toHaveBeenCalled()
  })

  it('sends a signed-out caller to the login page', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })

    await expect(makeTenantAdmin(input)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('creates or finds the account by phone for an official who has none', async () => {
    mockCaller()
    mockOfficialLookup({
      data: {
        user_id: null,
        name: 'Seed Bulk Official 05',
        phone: '46700000005',
        invite_status: 'confirmed',
      },
      error: null,
    })
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never)
    vi.mocked(resolveAdminAuthUser).mockResolvedValue({ ok: true, userId: 'new-user' })
    vi.mocked(grantTenantAdminRole).mockResolvedValue({ ok: true })

    expect(await makeTenantAdmin(input)).toEqual({})

    // E.164 for auth; officials.phone is stored without the '+'.
    expect(resolveAdminAuthUser).toHaveBeenCalledWith(
      expect.anything(),
      '+46700000005',
      'Seed Bulk Official 05',
      expect.objectContaining({ tenantId: TENANT_ID })
    )
    expect(grantTenantAdminRole).toHaveBeenCalledWith(TENANT_ID, 'new-user', {
      userId: CALLER_ID,
      role: 'tenant_admin',
    })
  })

  it('reports a failed account lookup as a failed grant', async () => {
    mockCaller()
    mockOfficialLookup({
      data: { user_id: null, name: 'X', phone: '46700000005', invite_status: 'confirmed' },
      error: null,
    })
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never)
    vi.mocked(resolveAdminAuthUser).mockResolvedValue({ ok: false })

    expect(await makeTenantAdmin(input)).toEqual({ error: 'actionErrors.grantAdminFailed' })
    expect(grantTenantAdminRole).not.toHaveBeenCalled()
  })

  it('refuses an official who has not confirmed', async () => {
    mockCaller()
    mockOfficialLookup({
      data: { user_id: null, name: 'Inv', phone: '46700000009', invite_status: 'invited' },
      error: null,
    })

    expect(await makeTenantAdmin(input)).toEqual({
      error: 'actionErrors.adminRoleRequiresConfirmed',
    })
    // No account is created for a number nobody has verified.
    expect(resolveAdminAuthUser).not.toHaveBeenCalled()
    expect(grantTenantAdminRole).not.toHaveBeenCalled()
  })

  it('refuses an official who is removed, or not in this tenant', async () => {
    mockCaller()
    mockOfficialLookup({ data: null, error: null })

    expect(await makeTenantAdmin(input)).toEqual({
      error: 'actionErrors.adminRoleOfficialUnavailable',
    })
    expect(grantTenantAdminRole).not.toHaveBeenCalled()
  })

  it('refuses a caller changing their own role', async () => {
    mockCaller()
    mockOfficialLookup({ data: { user_id: CALLER_ID, invite_status: 'confirmed' }, error: null })

    expect(await makeTenantAdmin(input)).toEqual({
      error: 'actionErrors.cannotChangeOwnAdminRole',
    })
    expect(grantTenantAdminRole).not.toHaveBeenCalled()
  })

  it('explains a full cap in tenant-admin wording', async () => {
    mockCaller()
    mockOfficialLookup({ data: { user_id: TARGET_ID, invite_status: 'confirmed' }, error: null })
    vi.mocked(grantTenantAdminRole).mockResolvedValue({ ok: false, reason: 'capReached' })

    expect(await makeTenantAdmin(input)).toEqual({
      error: 'actionErrors.adminCapReachedForTenant',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('removeTenantAdmin', () => {
  it('revokes the role of a confirmed official of this tenant', async () => {
    mockCaller()
    mockOfficialLookup({ data: { user_id: TARGET_ID, invite_status: 'confirmed' }, error: null })
    vi.mocked(revokeTenantAdminRole).mockResolvedValue({ ok: true })

    expect(await removeTenantAdmin(input)).toEqual({})
    expect(revokeTenantAdminRole).toHaveBeenCalledWith(TENANT_ID, TARGET_ID, {
      userId: CALLER_ID,
      role: 'tenant_admin',
    })
    expect(revalidatePath).toHaveBeenCalledWith(
      '/[tenantSlug]/admin/events/[eventId]/officials',
      'page'
    )
  })

  it('explains the last-admin guard in tenant-admin wording', async () => {
    mockCaller()
    mockOfficialLookup({ data: { user_id: TARGET_ID, invite_status: 'confirmed' }, error: null })
    vi.mocked(revokeTenantAdminRole).mockResolvedValue({ ok: false, reason: 'lastAdmin' })

    expect(await removeTenantAdmin(input)).toEqual({
      error: 'actionErrors.lastAdminCannotRemoveForTenant',
    })
  })

  it('reports an unexpected failure as a failed removal, not a failed grant', async () => {
    mockCaller()
    mockOfficialLookup({ data: { user_id: TARGET_ID, invite_status: 'confirmed' }, error: null })
    vi.mocked(revokeTenantAdminRole).mockResolvedValue({ ok: false, reason: 'failed' })

    expect(await removeTenantAdmin(input)).toEqual({ error: 'actionErrors.revokeAdminFailed' })
  })
})

// N23 (7c)
describe('addOfficialsToEvent', () => {
  const EVENT_ID = '33333333-3333-3333-3333-333333333333'
  const OTHER_ID = '44444444-4444-4444-4444-444444444444'
  const addInput = { tenantSlug: 'acme', eventId: EVENT_ID, officialIds: [OFFICIAL_ID, OTHER_ID] }

  // officials re-read, then the official_events upsert.
  function mockClient(found: unknown, upsertResult: unknown = { data: [{}], error: null }) {
    const read: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in']) read[m] = vi.fn(() => read)
    read.neq = vi.fn(() => Promise.resolve(found))
    const upsert = vi.fn(() => ({ select: vi.fn(() => Promise.resolve(upsertResult)) }))
    const from = vi.fn((table: string) => (table === 'officials' ? read : { upsert }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never)
    return { read, upsert }
  }

  beforeEach(() => {
    vi.mocked(getAdminTenant).mockResolvedValue({ id: TENANT_ID } as never)
  })

  it('refuses a caller who is not this tenant’s admin', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(null)
    const { upsert } = mockClient({ data: [], error: null })
    expect(await addOfficialsToEvent(addInput)).toEqual({ error: 'actionErrors.notAuthorized' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('refuses an empty selection', async () => {
    expect(await addOfficialsToEvent({ ...addInput, officialIds: [] })).toEqual({
      error: 'actionErrors.invalidRequest',
    })
  })

  // A crafted id from another tenant, or a removed official, is not re-read,
  // so it is not added.
  it('adds only the officials the tenant-filtered read returns, unseen', async () => {
    const { read, upsert } = mockClient({ data: [{ id: OFFICIAL_ID }], error: null })

    expect(await addOfficialsToEvent(addInput)).toEqual({ added: 1 })
    expect(read.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(read.neq).toHaveBeenCalledWith('invite_status', 'removed')
    expect(upsert).toHaveBeenCalledWith(
      [{ official_id: OFFICIAL_ID, event_id: EVENT_ID, tenant_id: TENANT_ID }],
      { onConflict: 'official_id,event_id', ignoreDuplicates: true }
    )
    expect(revalidatePath).toHaveBeenCalled()
  })

  it('reports a failed insert without revalidating', async () => {
    mockClient({ data: [{ id: OFFICIAL_ID }], error: null }, { data: null, error: { code: 'x' } })
    expect(await addOfficialsToEvent(addInput)).toEqual({
      error: 'actionErrors.addOfficialsFailed',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

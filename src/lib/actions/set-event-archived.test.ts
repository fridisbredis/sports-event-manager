import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setEventArchived } from './set-event-archived'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAdminTenant } from '@/lib/auth/tenant'
import { revalidatePath, updateTag } from 'next/cache'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  getAdminTenant: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Returns the key, so the assertions say which message was chosen.
vi.mock('@/lib/actions/action-error', () => ({
  translateActionError: vi.fn(async (key: string) => key),
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'

function tenant(tier: string) {
  return { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', tier, is_active: true }
}

// A chainable stand-in for supabase.from('events').update(...).eq()...select().
function mockUpdate(result: { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = []
  const chain: Record<string, unknown> = {}
  for (const method of ['update', 'eq', 'neq']) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args })
      return chain
    })
  }
  chain.select = vi.fn(async () => result)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    from: vi.fn(() => chain),
  } as never)
  return calls
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setEventArchived', () => {
  it('refuses a caller who is not this tenant’s admin, without writing', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(null)
    const calls = mockUpdate({ data: [], error: null })

    const result = await setEventArchived({
      tenantSlug: 'viadal',
      eventId: EVENT_ID,
      archived: true,
    })

    expect(result).toEqual({ error: 'actionErrors.notAuthorized' })
    expect(calls).toHaveLength(0)
  })

  it('refuses an event id that is not a uuid', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant('professional'))
    const calls = mockUpdate({ data: [], error: null })

    const result = await setEventArchived({ tenantSlug: 'viadal', eventId: 'nope', archived: true })

    expect(result).toEqual({ error: 'actionErrors.invalidRequest' })
    expect(calls).toHaveLength(0)
  })

  it('archives only a non-archived event of this tenant, and refreshes the screens', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant('professional'))
    const calls = mockUpdate({ data: [{ id: EVENT_ID }], error: null })

    const result = await setEventArchived({
      tenantSlug: 'viadal',
      eventId: EVENT_ID,
      archived: true,
    })

    expect(result).toEqual({})
    expect(calls).toEqual([
      { method: 'update', args: [{ status: 'archived' }] },
      { method: 'eq', args: ['id', EVENT_ID] },
      { method: 'eq', args: ['tenant_id', TENANT_ID] },
      { method: 'neq', args: ['status', 'archived'] },
    ])
    expect(revalidatePath).toHaveBeenCalledWith('/[tenantSlug]/admin', 'page')
    expect(updateTag).toHaveBeenCalledTimes(3)
  })

  it('brings an archived event back as a draft', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant('professional'))
    const calls = mockUpdate({ data: [{ id: EVENT_ID }], error: null })

    await setEventArchived({ tenantSlug: 'viadal', eventId: EVENT_ID, archived: false })

    expect(calls[0]).toEqual({ method: 'update', args: [{ status: 'draft' }] })
    expect(calls[3]).toEqual({ method: 'eq', args: ['status', 'archived'] })
  })

  it('skips the refresh when nothing changed (already archived)', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant('professional'))
    mockUpdate({ data: [], error: null })

    const result = await setEventArchived({
      tenantSlug: 'viadal',
      eventId: EVENT_ID,
      archived: true,
    })

    expect(result).toEqual({})
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  // Peter, N23 (c): with a single slot, the way forward is to archive the
  // active event; with more, it is to archive another or upgrade.
  it.each([
    ['standard', 'actionErrors.unarchiveArchiveFirst'],
    ['premium', 'actionErrors.unarchiveUpgrade'],
    ['professional', 'actionErrors.unarchiveUpgrade'],
  ])('explains the event cap on a %s tenant', async (tier, key) => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant(tier))
    mockUpdate({ data: null, error: { code: 'P0001', message: 'cap' } })

    const result = await setEventArchived({
      tenantSlug: 'viadal',
      eventId: EVENT_ID,
      archived: false,
    })

    expect(result).toEqual({ error: key })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('returns a generic message for any other database error', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant('professional'))
    mockUpdate({ data: null, error: { code: '08006', message: 'connection lost' } })

    const result = await setEventArchived({
      tenantSlug: 'viadal',
      eventId: EVENT_ID,
      archived: true,
    })

    expect(result.error).toBeTruthy()
    expect(result.error).not.toContain('connection lost')
  })
})

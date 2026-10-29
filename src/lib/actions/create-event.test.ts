import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEvent, type CreateEventInput } from './create-event'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAdminTenant } from '@/lib/auth/tenant'
import { revalidatePath } from 'next/cache'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  getAdminTenant: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Returns the key, so the assertions say which message was chosen.
vi.mock('@/lib/actions/action-error', () => ({
  translateActionError: vi.fn(async (key: string) => key),
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const SOURCE_ID = '22222222-2222-2222-2222-222222222222'
const STAGE_ID = '33333333-3333-3333-3333-333333333333'
const NEW_ID = '44444444-4444-4444-4444-444444444444'

function tenant(tier: string) {
  return { id: TENANT_ID, slug: 'viadal', color_palette: 'blue', tier, is_active: true }
}

function mockRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as never)
  return rpc
}

const INPUT: CreateEventInput = {
  tenantSlug: 'viadal',
  name: '  Viadal 2027 ',
  sourceEventId: SOURCE_ID,
  copy: { stages: true, work_areas: true },
  stageDates: { [STAGE_ID]: '2027-05-31' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createEvent', () => {
  it('refuses a caller who is not this tenant’s admin, without calling the RPC', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(null)
    const rpc = mockRpc({ data: null, error: null })

    expect(await createEvent(INPUT)).toEqual({ error: 'actionErrors.notAuthorized' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['an empty name', { name: '   ' }],
    ['a source that is not a uuid', { sourceEventId: 'nope' }],
    ['an unknown copy option', { copy: { logo: true } as never }],
    ['a malformed date', { stageDates: { [STAGE_ID]: '31/05/2027' } }],
  ])('refuses %s', async (_label, patch) => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant('premium'))
    const rpc = mockRpc({ data: null, error: null })

    expect(await createEvent({ ...INPUT, ...patch })).toEqual({
      error: 'actionErrors.invalidRequest',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('creates the event through create_event and returns its id', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant('premium'))
    const rpc = mockRpc({ data: { event_id: NEW_ID }, error: null })

    expect(await createEvent(INPUT)).toEqual({ eventId: NEW_ID })
    expect(rpc).toHaveBeenCalledWith('create_event', {
      p_tenant_id: TENANT_ID,
      p_name: 'Viadal 2027',
      p_source_event_id: SOURCE_ID,
      p_copy: { stages: true, work_areas: true },
      p_stage_dates: { [STAGE_ID]: '2027-05-31' },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/[tenantSlug]/admin', 'page')
  })

  it('passes a blank event as a null source', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant('premium'))
    const rpc = mockRpc({ data: { event_id: NEW_ID }, error: null })

    await createEvent({ ...INPUT, sourceEventId: null, copy: {}, stageDates: {} })
    expect(rpc).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({ p_source_event_id: null, p_copy: {} })
    )
  })

  it.each([
    ['standard', 'actionErrors.createEventArchiveFirst'],
    ['premium', 'actionErrors.createEventUpgrade'],
  ])('explains the event cap on a %s tenant', async (tier, key) => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant(tier))
    mockRpc({ data: null, error: { code: 'P0001', message: 'cap' } })

    expect(await createEvent(INPUT)).toEqual({ error: key })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('returns a generic message for any other database error', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant('premium'))
    mockRpc({ data: null, error: { code: '22023', message: 'stage x needs a date' } })

    const result = await createEvent(INPUT)
    expect('error' in result && result.error).toBeTruthy()
    expect(JSON.stringify(result)).not.toContain('needs a date')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

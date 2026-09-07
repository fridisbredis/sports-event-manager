import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveEvent } from './actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  hasAdminAccessToTenant: vi.fn(),
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

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['update', 'delete', 'insert', 'eq']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockClient(fromMock: ReturnType<typeof vi.fn>, rpcMock: ReturnType<typeof vi.fn>) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: fromMock,
    rpc: rpcMock,
  } as never)
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'

const BASE_INPUT = {
  tenantSlug: 'viadal',
  tenantId: TENANT_ID,
  eventId: EVENT_ID,
  name: 'Viadal 2026',
  event_type: 'race',
  description: '',
  location: '',
  logo_url: '',
  scheduling_granularity_min: 30,
  stages: [],
  facilities: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('saveEvent', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
      rpc: vi.fn(),
    } as never)

    await expect(saveEvent(BASE_INPUT)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('returns an authorization error and never touches the database when access is denied', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const fromMock = vi.fn()
    const rpcMock = vi.fn()
    mockClient(fromMock, rpcMock)

    const result = await saveEvent(BASE_INPUT)

    expect(result).toEqual({ error: 'Not authorized' })
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(fromMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns the db error message and skips sync_event_stages when the events update fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventsBuilder = chain({ error: { message: 'events update failed' } })
    const fromMock = vi.fn().mockReturnValueOnce(eventsBuilder)
    const rpcMock = vi.fn()
    mockClient(fromMock, rpcMock)

    const result = await saveEvent(BASE_INPUT)

    expect(result).toEqual({ error: 'events update failed' })
    expect(rpcMock).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('returns the rpc error message and skips facility writes when sync_event_stages fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventsBuilder = chain({ error: null })
    const fromMock = vi.fn().mockReturnValueOnce(eventsBuilder)
    const rpcMock = vi.fn().mockResolvedValue({ error: { message: 'stage sync failed' } })
    mockClient(fromMock, rpcMock)

    const result = await saveEvent(BASE_INPUT)

    expect(result).toEqual({ error: 'stage sync failed' })
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('returns the db error message and skips revalidation when deleting facilities fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventsBuilder = chain({ error: null })
    const delFacBuilder = chain({ error: { message: 'delete facilities failed' } })
    const fromMock = vi.fn().mockReturnValueOnce(eventsBuilder).mockReturnValueOnce(delFacBuilder)
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    mockClient(fromMock, rpcMock)

    const result = await saveEvent(BASE_INPUT)

    expect(result).toEqual({ error: 'delete facilities failed' })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('saves with no facilities, revalidates, and invalidates all three Group 1 cache tags', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventsBuilder = chain({ error: null })
    const delFacBuilder = chain({ error: null })
    const fromMock = vi.fn().mockReturnValueOnce(eventsBuilder).mockReturnValueOnce(delFacBuilder)
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    mockClient(fromMock, rpcMock)

    const result = await saveEvent(BASE_INPUT)

    expect(result).toEqual({})
    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/event')
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/dashboard')
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-event-info`)
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-event`)
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-workstations`)
    // PERF-06 / F-PERF-04 Phase 3
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-dashboard`)
  })

  it('inserts non-blank facilities and returns the db error when the insert fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventsBuilder = chain({ error: null })
    const delFacBuilder = chain({ error: null })
    const insFacBuilder = chain({ error: { message: 'insert facilities failed' } })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(eventsBuilder)
      .mockReturnValueOnce(delFacBuilder)
      .mockReturnValueOnce(insFacBuilder)
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    mockClient(fromMock, rpcMock)

    const result = await saveEvent({
      ...BASE_INPUT,
      facilities: [{ label: 'Water station', position: 0 }],
    })

    expect(result).toEqual({ error: 'insert facilities failed' })
    expect(insFacBuilder.insert).toHaveBeenCalledWith([
      { label: 'Water station', position: 0, event_id: EVENT_ID, tenant_id: TENANT_ID },
    ])
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })
})

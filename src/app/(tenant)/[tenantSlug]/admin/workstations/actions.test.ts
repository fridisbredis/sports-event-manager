import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWorkstation, updateWorkstation, deleteWorkstation } from './actions'
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

function mockClient(rpcMock: ReturnType<typeof vi.fn>) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    rpc: rpcMock,
  } as never)
}

function mockFromClient(fromMock: ReturnType<typeof vi.fn>) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: fromMock,
  } as never)
}

// Minimal stand-in for a Postgrest query builder: update/delete/eq return the
// same chainable object, insert and the final .then() resolve to `result`.
function chainResult(result: { error: unknown }) {
  const chain = {
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    insert: vi.fn(() => Promise.resolve(result)),
    eq: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'
const WORKSTATION_ID = '33333333-3333-3333-3333-333333333333'

const BASE_INPUT = {
  tenantSlug: 'viadal',
  tenantId: TENANT_ID,
  eventId: EVENT_ID,
  stageId: null,
  name: 'Water station',
  description: '',
  capacity: 4,
  recurring: false,
  windows: [{ window_start: '2026-09-01T08:00:00Z', window_end: '2026-09-01T16:00:00Z' }],
  todos: ['Fill cups', ''],
  schedulingGranularityMin: 30,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createWorkstation', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: vi.fn(),
    } as never)

    await expect(createWorkstation(BASE_INPUT)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('returns an authorization error for an invalid tenantId and never calls rpc', async () => {
    const rpcMock = vi.fn()
    mockClient(rpcMock)

    const result = await createWorkstation({ ...BASE_INPUT, tenantId: 'not-a-uuid' })

    expect(result).toEqual({ error: 'Not authorized' })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns an authorization error when access is denied and never calls rpc', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const rpcMock = vi.fn()
    mockClient(rpcMock)

    const result = await createWorkstation(BASE_INPUT)

    expect(result).toEqual({ error: 'Not authorized' })
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns a validation error when a window is shorter than the scheduling granularity and never calls rpc', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi.fn()
    mockClient(rpcMock)

    const result = await createWorkstation({
      ...BASE_INPUT,
      windows: [{ window_start: '2026-09-01T08:00:00Z', window_end: '2026-09-01T08:10:00Z' }],
      schedulingGranularityMin: 30,
    })

    expect(result).toEqual({ error: 'Operating window is shorter than the scheduling granularity' })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('calls create_workstation with the filtered windows/todos payload and revalidates on success', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi.fn().mockResolvedValue({ data: 'ws-1', error: null })
    mockClient(rpcMock)

    const result = await createWorkstation(BASE_INPUT)

    expect(result).toEqual({})
    expect(rpcMock).toHaveBeenCalledWith('create_workstation', {
      p_tenant_id: TENANT_ID,
      p_event_id: EVENT_ID,
      p_stage_id: undefined,
      p_name: 'Water station',
      p_description: undefined,
      p_capacity_ceiling: 4,
      p_recurring: false,
      p_windows: [{ window_start: '2026-09-01T08:00:00Z', window_end: '2026-09-01T16:00:00Z' }],
      p_todos: [{ instruction_text: 'Fill cups', position: 0 }],
    })
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/workstations')
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-workstations`)
    // PERF-06 / F-PERF-04 Phase 3
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-dashboard`)
  })

  it('translates the rpc error and skips revalidation when the rpc call fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'window_end must be after window_start' },
    })
    mockClient(rpcMock)

    const result = await createWorkstation(BASE_INPUT)

    // F-REL-22: never forward the raw DB error message to the client.
    expect(result).toEqual({ error: 'Something went wrong while saving. Please try again.' })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })
})

const UPDATE_BASE_INPUT = {
  tenantSlug: 'viadal',
  tenantId: TENANT_ID,
  workstationId: WORKSTATION_ID,
  stageId: null,
  name: 'Water station',
  description: '',
  capacity: 4,
  recurring: false,
  windows: [{ window_start: '2026-09-01T08:00:00Z', window_end: '2026-09-01T16:00:00Z' }],
  todos: ['Fill cups', ''],
  schedulingGranularityMin: 30,
}

// REL-01: workstation/windows/todos are now updated atomically by the
// update_workstation RPC (migration 20260908130927) instead of five
// separate .update()/.delete()/.insert() calls — see
// tests/integration/update-workstation-atomicity.test.ts for the
// real-Postgres proof that a partial failure rolls back all three tables.
// These unit tests only prove the call site passes the right args and
// handles the RPC's response correctly.
describe('updateWorkstation', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: vi.fn(),
    } as never)

    await expect(updateWorkstation(UPDATE_BASE_INPUT)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('returns an authorization error for an invalid tenantId and never calls rpc', async () => {
    const rpcMock = vi.fn()
    mockClient(rpcMock)

    const result = await updateWorkstation({ ...UPDATE_BASE_INPUT, tenantId: 'not-a-uuid' })

    expect(result).toEqual({ error: 'Not authorized' })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns an authorization error when access is denied and never calls rpc', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const rpcMock = vi.fn()
    mockClient(rpcMock)

    const result = await updateWorkstation(UPDATE_BASE_INPUT)

    expect(result).toEqual({ error: 'Not authorized' })
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns a validation error when a window is shorter than the scheduling granularity and never calls rpc', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi.fn()
    mockClient(rpcMock)

    const result = await updateWorkstation({
      ...UPDATE_BASE_INPUT,
      windows: [{ window_start: '2026-09-01T08:00:00Z', window_end: '2026-09-01T08:10:00Z' }],
      schedulingGranularityMin: 30,
    })

    expect(result).toEqual({ error: 'Operating window is shorter than the scheduling granularity' })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('calls update_workstation with the filtered windows/todos payload and revalidates on success', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null })
    mockClient(rpcMock)

    const result = await updateWorkstation(UPDATE_BASE_INPUT)

    expect(result).toEqual({})
    expect(rpcMock).toHaveBeenCalledWith('update_workstation', {
      p_workstation_id: WORKSTATION_ID,
      p_tenant_id: TENANT_ID,
      p_stage_id: undefined,
      p_name: 'Water station',
      p_description: undefined,
      p_capacity_ceiling: 4,
      p_recurring: false,
      p_windows: [{ window_start: '2026-09-01T08:00:00Z', window_end: '2026-09-01T16:00:00Z' }],
      p_todos: ['Fill cups'],
    })
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/workstations')
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-workstations`)
    // PERF-06 / F-PERF-04 Phase 3
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-dashboard`)
  })

  it('translates the rpc error and skips revalidation when the rpc call fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Invalid workstation payload' },
    })
    mockClient(rpcMock)

    const result = await updateWorkstation(UPDATE_BASE_INPUT)

    // F-REL-22: never forward the raw DB error message to the client.
    expect(result).toEqual({ error: 'Something went wrong while saving. Please try again.' })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('calls update_workstation with empty windows/todos arrays when both are empty', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null })
    mockClient(rpcMock)

    const result = await updateWorkstation({ ...UPDATE_BASE_INPUT, windows: [], todos: [] })

    expect(result).toEqual({})
    expect(rpcMock).toHaveBeenCalledWith(
      'update_workstation',
      expect.objectContaining({ p_windows: [], p_todos: [] })
    )
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/workstations')
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-workstations`)
    // PERF-06 / F-PERF-04 Phase 3
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-dashboard`)
  })
})

const DELETE_BASE_INPUT = {
  tenantSlug: 'viadal',
  tenantId: TENANT_ID,
  workstationId: WORKSTATION_ID,
}

describe('deleteWorkstation', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
    } as never)

    await expect(deleteWorkstation(DELETE_BASE_INPUT)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('returns an authorization error for an invalid tenantId and never touches the database', async () => {
    const fromMock = vi.fn()
    mockFromClient(fromMock)

    const result = await deleteWorkstation({ ...DELETE_BASE_INPUT, tenantId: 'not-a-uuid' })

    expect(result).toEqual({ error: 'Not authorized' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('returns an authorization error when access is denied and never touches the database', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const fromMock = vi.fn()
    mockFromClient(fromMock)

    const result = await deleteWorkstation(DELETE_BASE_INPUT)

    expect(result).toEqual({ error: 'Not authorized' })
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('translates the delete error and skips revalidation when the delete fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(chainResult({ error: { message: 'delete failed' } }))
    mockFromClient(fromMock)

    const result = await deleteWorkstation(DELETE_BASE_INPUT)

    // F-REL-22: never forward the raw DB error message to the client.
    expect(result).toEqual({ error: 'Something went wrong while deleting. Please try again.' })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('deletes the workstation scoped to id and tenant, then revalidates on success', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const wsChain = chainResult({ error: null })
    const fromMock = vi.fn().mockReturnValueOnce(wsChain)
    mockFromClient(fromMock)

    const result = await deleteWorkstation(DELETE_BASE_INPUT)

    expect(result).toEqual({})
    expect(fromMock).toHaveBeenCalledWith('workstations')
    expect(wsChain.eq).toHaveBeenNthCalledWith(1, 'id', WORKSTATION_ID)
    expect(wsChain.eq).toHaveBeenNthCalledWith(2, 'tenant_id', TENANT_ID)
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/workstations')
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-workstations`)
    // PERF-06 / F-PERF-04 Phase 3
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-dashboard`)
  })
})

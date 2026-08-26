import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWorkstation } from './actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

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
}))

function mockClient(rpcMock: ReturnType<typeof vi.fn>) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    rpc: rpcMock,
  } as never)
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'

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
  })

  it('returns the rpc error message and skips revalidation when the rpc call fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'window_end must be after window_start' },
    })
    mockClient(rpcMock)

    const result = await createWorkstation(BASE_INPUT)

    expect(result).toEqual({ error: 'window_end must be after window_start' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

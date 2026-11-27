import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toggleMyTaskDone, toggleMyTaskTodo } from './actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { revalidatePath } from 'next/cache'

// N72: the official's task ticks. The RPCs do the real authorisation (they
// check the caller is a confirmed assignee); these tests pin what the action
// itself owns — input validation, the tenant gate, which RPC it calls with
// what, and the revalidation.

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getOfficialTenant: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/actions/action-error', () => ({
  translateActionError: vi.fn(async (key: string) => key),
}))

const TASK_ID = '22222222-2222-2222-2222-222222222222'

let rpc: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  rpc = vi.fn().mockResolvedValue({ data: {}, error: null })
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as never)
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
  vi.mocked(getOfficialTenant).mockResolvedValue({ id: 'tenant-1' } as never)
})

describe('toggleMyTaskDone', () => {
  it('calls set_task_done and revalidates the schedule', async () => {
    expect(await toggleMyTaskDone({ tenantSlug: 'viadal', id: TASK_ID, checked: true })).toEqual({})
    expect(rpc).toHaveBeenCalledWith('set_task_done', { p_task_id: TASK_ID, p_done: true })
    expect(revalidatePath).toHaveBeenCalledWith('/[tenantSlug]/events/[eventId]/schedule', 'page')
  })

  it('returns the save-failed key when the RPC refuses', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not authorized' } })
    expect(await toggleMyTaskDone({ tenantSlug: 'viadal', id: TASK_ID, checked: true })).toEqual({
      error: 'checklist.saveFailed',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('refuses a caller outside the tenant without calling the database', async () => {
    vi.mocked(getOfficialTenant).mockResolvedValue(null as never)
    expect(await toggleMyTaskDone({ tenantSlug: 'viadal', id: TASK_ID, checked: true })).toEqual({
      error: 'actionErrors.notAuthorized',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a malformed id', async () => {
    expect(await toggleMyTaskDone({ tenantSlug: 'viadal', id: 'nope', checked: true })).toEqual({
      error: 'actionErrors.notAuthorized',
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('toggleMyTaskTodo', () => {
  it('calls set_task_todo_checked', async () => {
    await toggleMyTaskTodo({ tenantSlug: 'viadal', id: TASK_ID, checked: false })
    expect(rpc).toHaveBeenCalledWith('set_task_todo_checked', {
      p_todo_id: TASK_ID,
      p_checked: false,
    })
  })
})

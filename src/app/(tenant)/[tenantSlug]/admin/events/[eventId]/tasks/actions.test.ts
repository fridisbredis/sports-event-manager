import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveTask, deleteTask, setTaskDone } from './actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
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

// The translators hit the i18n loader; the key is enough to assert on.
vi.mock('@/lib/actions/action-error', () => ({
  translateActionError: vi.fn(async (key: string) => key),
}))

vi.mock('@/lib/actions/db-error-message', () => ({
  translateDbError: vi.fn(
    async (
      _log: string,
      error: { code?: string },
      fallback: string,
      overrides?: Record<string, string>
    ) => overrides?.[error.code ?? ''] ?? fallback
  ),
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'
const STAGE_ID = '33333333-3333-3333-3333-333333333333'
const TASK_ID = '44444444-4444-4444-4444-444444444444'

const BASE = {
  tenantId: TENANT_ID,
  eventId: EVENT_ID,
  taskId: null,
  stageId: STAGE_ID,
  name: '  Order bibs  ',
  description: '   ',
  color: 'sky',
  startsAt: null,
  deadline: '2026-12-01T10:00',
  done: false,
  assigneeIds: [],
}

function mockClient(overrides: Record<string, unknown>) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    ...overrides,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
})

describe('saveTask', () => {
  it('sends trimmed fields, UTC times and the done flag to save_task', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: TASK_ID }, error: null })
    mockClient({ rpc })

    const result = await saveTask({
      ...BASE,
      startsAt: '2026-12-01T08:00',
      assigneeIds: ['a', 'a', 'b'],
      done: true,
    })

    expect(result).toEqual({ id: TASK_ID })
    expect(rpc).toHaveBeenCalledWith('save_task', {
      p_tenant_id: TENANT_ID,
      p_event_id: EVENT_ID,
      p_task_id: null,
      p_stage_id: STAGE_ID,
      p_name: 'Order bibs',
      p_description: null,
      p_color: 'sky',
      p_starts_at: '2026-12-01T08:00:00.000Z',
      p_deadline: '2026-12-01T10:00:00.000Z',
      p_done: true,
      p_assignee_ids: ['a', 'b'],
    })
    expect(revalidatePath).toHaveBeenCalledWith(
      '/[tenantSlug]/admin/events/[eventId]/tasks',
      'page'
    )
  })

  it('drops a colour outside the palette instead of failing', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: TASK_ID }, error: null })
    mockClient({ rpc })

    await saveTask({ ...BASE, color: 'neon' })
    expect(rpc.mock.calls[0][1].p_color).toBeNull()
  })

  it('refuses a start after the deadline without calling the database', async () => {
    const rpc = vi.fn()
    mockClient({ rpc })

    const result = await saveTask({ ...BASE, startsAt: '2026-12-01T11:00' })
    expect(result).toEqual({ error: 'actionErrors.taskStartAfterDeadline' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses an empty name and a malformed deadline', async () => {
    const rpc = vi.fn()
    mockClient({ rpc })

    expect(await saveTask({ ...BASE, name: '  ' })).toEqual({ error: 'actionErrors.invalidName' })
    expect(await saveTask({ ...BASE, deadline: 'tomorrow' })).toEqual({
      error: 'actionErrors.invalidRequest',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a caller without admin access', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const rpc = vi.fn()
    mockClient({ rpc })

    expect(await saveTask(BASE)).toEqual({ error: 'actionErrors.notAuthorized' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('translates a database refusal', async () => {
    mockClient({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '22023' } }) })
    expect(await saveTask(BASE)).toEqual({ error: 'tasks.genericSaveError' })
  })
})

describe('deleteTask', () => {
  it('deletes within the tenant', async () => {
    const eq = vi.fn()
    const chain = {
      delete: vi.fn(() => chain),
      eq: eq.mockImplementation(() => chain),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    }
    const from = vi.fn(() => chain)
    mockClient({ from })

    expect(await deleteTask({ tenantId: TENANT_ID, taskId: TASK_ID })).toEqual({})
    expect(from).toHaveBeenCalledWith('tasks')
    expect(eq).toHaveBeenCalledWith('id', TASK_ID)
    expect(eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })
})

describe('setTaskDone', () => {
  it('calls set_task_done and returns the stored flag', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: TASK_ID, done: true, done_at: '2026-12-01T09:00:00Z' },
      error: null,
    })
    mockClient({ rpc })

    expect(await setTaskDone({ tenantId: TENANT_ID, taskId: TASK_ID, done: true })).toEqual({
      done: true,
    })
    expect(rpc).toHaveBeenCalledWith('set_task_done', { p_task_id: TASK_ID, p_done: true })
  })
})

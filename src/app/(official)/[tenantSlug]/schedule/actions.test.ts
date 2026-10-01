import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toggleChecklistItem } from './actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { revalidatePath } from 'next/cache'

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

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const TODO_ID = '22222222-2222-2222-2222-222222222222'
const WORKSTATION_ID = '33333333-3333-3333-3333-333333333333'
const USER_ID = '44444444-4444-4444-4444-444444444444'

const BASE_INPUT = {
  tenantSlug: 'viadal',
  todoId: TODO_ID,
  workstationId: WORKSTATION_ID,
  timeslotStart: '2026-10-01T08:00:00.000Z',
  timeslotEnd: '2026-10-01T12:00:00.000Z',
  checked: true,
}

type Captured = {
  upsert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
}

/**
 * Stands in for the three tables this action touches. `checksError` and
 * `auditError` let a test fail one leg independently, which is the point of
 * most of the cases below.
 */
function mockClient(
  opts: { checksError?: unknown; auditError?: unknown; officialName?: string | null } = {}
): Captured {
  const captured: Captured = {
    upsert: vi.fn(() => Promise.resolve({ error: opts.checksError ?? null })),
    delete: vi.fn(),
    insert: vi.fn(() => Promise.resolve({ error: opts.auditError ?? null })),
    eq: vi.fn(),
  }

  const deleteChain = {
    eq: vi.fn(() => deleteChain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ error: opts.checksError ?? null }).then(resolve, reject),
  }
  captured.delete = vi.fn(() => deleteChain)
  captured.eq = deleteChain.eq

  const officialsChain = {
    select: vi.fn(() => officialsChain),
    eq: vi.fn(() => officialsChain),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: opts.officialName === undefined ? { name: 'Alice' } : { name: opts.officialName },
        error: null,
      })
    ),
  }

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    from: vi.fn((table: string) => {
      if (table === 'checklist_item_checks') {
        return { upsert: captured.upsert, delete: captured.delete }
      }
      if (table === 'checklist_item_events') return { insert: captured.insert }
      if (table === 'officials') return officialsChain
      throw new Error(`unexpected table ${table}`)
    }),
  } as never)

  return captured
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue({ id: USER_ID } as never)
  vi.mocked(getOfficialTenant).mockResolvedValue({
    id: TENANT_ID,
    slug: 'viadal',
    officialId: 'official-1',
  } as never)
})

describe('toggleChecklistItem authorization', () => {
  it('refuses an unauthenticated caller before touching the database', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never)
    const captured = mockClient()

    const result = await toggleChecklistItem(BASE_INPUT)

    expect(result.error).toBe('Behörighet saknas')
    expect(captured.upsert).not.toHaveBeenCalled()
  })

  it('refuses a caller with no access to the tenant', async () => {
    vi.mocked(getOfficialTenant).mockResolvedValue(null as never)
    const captured = mockClient()

    const result = await toggleChecklistItem(BASE_INPUT)

    expect(result.error).toBe('Behörighet saknas')
    expect(captured.upsert).not.toHaveBeenCalled()
  })

  it('refuses a malformed id rather than passing it to the database', async () => {
    const captured = mockClient()

    const result = await toggleChecklistItem({ ...BASE_INPUT, todoId: 'not-a-uuid' })

    expect(result.error).toBe('Behörighet saknas')
    expect(captured.upsert).not.toHaveBeenCalled()
  })

  it('writes the tenant from the resolved access check, not from the caller', async () => {
    const captured = mockClient()

    await toggleChecklistItem(BASE_INPUT)

    // The input carries only a slug; tenant_id must come from the server's own
    // resolution of it, so a caller cannot name someone else's tenant.
    expect(captured.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TENANT_ID, checked_by: USER_ID }),
      expect.anything()
    )
  })
})

describe('toggleChecklistItem checking', () => {
  it('upserts on the per-shift unique index so a tied race is not an error', async () => {
    const captured = mockClient()

    const result = await toggleChecklistItem(BASE_INPUT)

    expect(result.error).toBeUndefined()
    expect(captured.upsert).toHaveBeenCalledWith(expect.anything(), {
      onConflict: 'todo_id,workstation_id,timeslot_start,timeslot_end',
    })
  })

  it('records a checked audit event naming the actor', async () => {
    const captured = mockClient()

    await toggleChecklistItem(BASE_INPUT)

    expect(captured.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'checked',
        actor_user_id: USER_ID,
        actor_name: 'Alice',
        tenant_id: TENANT_ID,
      })
    )
  })

  it('reports a failed write instead of pretending it saved', async () => {
    const captured = mockClient({ checksError: { message: 'rls' } })

    const result = await toggleChecklistItem(BASE_INPUT)

    expect(result.error).toBe('checklist.saveFailed')
    // No audit row for a write that never happened.
    expect(captured.insert).not.toHaveBeenCalled()
  })
})

describe('toggleChecklistItem unchecking', () => {
  it('deletes the row and audits the uncheck', async () => {
    const captured = mockClient()

    const result = await toggleChecklistItem({ ...BASE_INPUT, checked: false })

    expect(result.error).toBeUndefined()
    expect(captured.delete).toHaveBeenCalled()
    expect(captured.upsert).not.toHaveBeenCalled()
    expect(captured.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'unchecked', actor_user_id: USER_ID })
    )
  })

  it('scopes the delete to the one item on the one shift', async () => {
    const captured = mockClient()

    await toggleChecklistItem({ ...BASE_INPUT, checked: false })

    // All four columns of the unique index — without the timeslot pair this
    // would clear the item for every shift on the station.
    expect(captured.eq).toHaveBeenCalledWith('todo_id', TODO_ID)
    expect(captured.eq).toHaveBeenCalledWith('workstation_id', WORKSTATION_ID)
    expect(captured.eq).toHaveBeenCalledWith('timeslot_start', '2026-10-01T08:00:00.000Z')
    expect(captured.eq).toHaveBeenCalledWith('timeslot_end', '2026-10-01T12:00:00.000Z')
  })
})

describe('toggleChecklistItem audit trail', () => {
  it('does not fail the caller when only the audit write fails', async () => {
    // The state change already committed; failing the response here would
    // make the UI show an error over work that was in fact saved.
    const captured = mockClient({ auditError: { message: 'boom' } })

    const result = await toggleChecklistItem(BASE_INPUT)

    expect(result.error).toBeUndefined()
    expect(captured.upsert).toHaveBeenCalled()
  })

  it('still records the event when the actor has no officials row', async () => {
    const captured = mockClient({ officialName: null })

    await toggleChecklistItem(BASE_INPUT)

    expect(captured.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_name: null, actor_user_id: USER_ID })
    )
  })
})

describe('toggleChecklistItem revalidation', () => {
  it('revalidates the schedule so colleagues on the shift see the change', async () => {
    mockClient()

    await toggleChecklistItem(BASE_INPUT)

    expect(revalidatePath).toHaveBeenCalledWith('/viadal/schedule')
  })
})

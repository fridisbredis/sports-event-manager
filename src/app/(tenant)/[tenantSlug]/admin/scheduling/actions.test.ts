import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AssignmentStatus } from '@/types/app'

// PERF-02: saveAssignments delegates the whole batch to the
// save_assignments_batch RPC (migration 0033) and maps its custom SQLSTATEs
// to user-facing strings. These tests pin that mapping and the zod gate in
// front of it — both are the only things standing between a client-controlled
// payload and the RPC.

const rpc = vi.fn()
const from = vi.fn()
const getUser = vi.fn()
const hasAdminAccessToTenant = vi.fn()
const revalidatePath = vi.fn()
const updateTag = vi.fn()
const loggerWarn = vi.fn()
const loggerError = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser }, rpc, from }),
}))
vi.mock('@/lib/auth/tenant', () => ({
  hasAdminAccessToTenant: (...args: unknown[]) => hasAdminAccessToTenant(...args),
}))
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
  updateTag: (...args: unknown[]) => updateTag(...args),
}))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: (...a: unknown[]) => loggerError(...a),
  },
}))

const { saveAssignments } = await import('./actions')

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OFFICIAL_ID = '22222222-2222-4222-8222-222222222222'
const WORKSTATION_ID = '33333333-3333-4333-8333-333333333333'
const ASSIGNMENT_ID = '44444444-4444-4444-8444-444444444444'

const VALID_ADDITION = {
  official_id: OFFICIAL_ID,
  workstation_id: WORKSTATION_ID,
  timeslot_start: '2026-09-01T08:00:00.000Z',
  timeslot_end: '2026-09-01T09:00:00.000Z',
  slot_index: 1,
}

// supabase.rpc(...).select(...) is awaited, so the mock has to return a
// thenable from .select().
function rpcResult(result: { data?: unknown; error?: unknown }) {
  return {
    select: () => ({
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(
          resolve,
          reject
        ),
    }),
  }
}

// The time-off guard reads official_unavailability before the RPC runs. Its
// builder is chainable and thenable, like PostgREST's.
function timeOffRows(rows: unknown[] = [], error: unknown = null) {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'lt', 'gt']) builder[m] = () => builder
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: rows, error }).then(resolve, reject)
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  hasAdminAccessToTenant.mockResolvedValue(true)
  // Default: nobody has time off, so existing tests exercise the RPC path.
  from.mockReturnValue(timeOffRows([]))
})

describe('saveAssignments RPC error mapping', () => {
  it('maps ASG01 to the slot-taken message', async () => {
    rpc.mockReturnValue(rpcResult({ error: { code: 'ASG01' } }))

    const result = await saveAssignments('acme', TENANT_ID, [VALID_ADDITION], [])

    expect(result.error).toBe(
      'Someone else just took that slot. Please reload the schedule and try again.'
    )
  })

  it('maps ASG02 to the not-authorized message', async () => {
    rpc.mockReturnValue(rpcResult({ error: { code: 'ASG02' } }))

    const result = await saveAssignments('acme', TENANT_ID, [VALID_ADDITION], [])

    expect(result.error).toBe('Not authorized')
  })

  it('maps ASG03 to the generic invalid-request message and logs it', async () => {
    rpc.mockReturnValue(rpcResult({ error: { code: 'ASG03' } }))

    const result = await saveAssignments('acme', TENANT_ID, [VALID_ADDITION], [])

    expect(result.error).toBe('Invalid request')
    expect(loggerWarn).toHaveBeenCalled()
  })

  it('maps an unrecognised errcode to the generic failure message and logs at error', async () => {
    rpc.mockReturnValue(rpcResult({ error: { code: '23505', message: 'boom' } }))

    const result = await saveAssignments('acme', TENANT_ID, [VALID_ADDITION], [])

    expect(result.error).toBe('Failed to save assignments. Please try again.')
    expect(loggerError).toHaveBeenCalled()
  })

  it('returns the inserted rows and revalidates on success', async () => {
    const inserted = [
      {
        id: ASSIGNMENT_ID,
        official_id: OFFICIAL_ID,
        workstation_id: WORKSTATION_ID,
        timeslot_start: VALID_ADDITION.timeslot_start,
        slot_index: 1,
      },
    ]
    rpc.mockReturnValue(rpcResult({ data: inserted }))

    const result = await saveAssignments('acme', TENANT_ID, [VALID_ADDITION], [])

    expect(result.error).toBeUndefined()
    expect(result.inserted).toEqual(inserted)
    expect(revalidatePath).toHaveBeenCalledWith('/acme/admin/scheduling')
    // PERF-06 / F-PERF-04 Phase 3: the dashboard's cached scheduling-warning
    // counts read assignments transitively, so a successful save invalidates
    // that tag too.
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-dashboard`)
  })
})

describe('saveAssignments payload validation', () => {
  it('rejects an addition with a missing workstation_id without calling the RPC', async () => {
    const result = await saveAssignments(
      'acme',
      TENANT_ID,
      [{ ...VALID_ADDITION, workstation_id: null as unknown as string }],
      []
    )

    expect(result.error).toBe('Invalid request')
    expect(rpc).not.toHaveBeenCalled()
    expect(loggerWarn).toHaveBeenCalled()
  })

  it('rejects a non-uuid deletion id without calling the RPC', async () => {
    const result = await saveAssignments('acme', TENANT_ID, [], ['not-a-uuid'])

    expect(result.error).toBe('Invalid request')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a status outside the assignments status CHECK without calling the RPC', async () => {
    const result = await saveAssignments(
      'acme',
      TENANT_ID,
      [],
      [],
      // Cast because StatusUpdate.status is AssignmentStatus now, so tsc
      // rejects this at compile time — which is the point of that change. The
      // cast keeps the runtime assertion honest for an untyped caller (a
      // direct Server Action POST), which is the only way this input arrives.
      [{ id: ASSIGNMENT_ID, status: 'deleted' as unknown as AssignmentStatus }]
    )

    expect(result.error).toBe('Invalid request')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a zero slot_index — the grid is 1-based', async () => {
    const result = await saveAssignments(
      'acme',
      TENANT_ID,
      [{ ...VALID_ADDITION, slot_index: 0 }],
      []
    )

    expect(result.error).toBe('Invalid request')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts a timestamptz-style offset, not just a Z suffix', async () => {
    rpc.mockReturnValue(rpcResult({ data: [] }))

    const result = await saveAssignments(
      'acme',
      TENANT_ID,
      [
        {
          ...VALID_ADDITION,
          timeslot_start: '2026-09-01T08:00:00+00:00',
          timeslot_end: '2026-09-01T09:00:00+00:00',
        },
      ],
      []
    )

    expect(result.error).toBeUndefined()
    expect(rpc).toHaveBeenCalled()
  })

  it('rejects an invalid tenantId before touching the payload', async () => {
    const result = await saveAssignments('acme', 'not-a-uuid', [VALID_ADDITION], [])

    expect(result.error).toBe('Not authorized')
    expect(rpc).not.toHaveBeenCalled()
  })
})

// The caps exist mainly in migration 0033 (the RPC is granted to
// `authenticated`, so it is reachable without this action). These tests cover
// the client-facing half: the message has to say "too large", never the
// generic "Invalid request", or nobody can tell an oversized save from a
// broken caller.
describe('saveAssignments batch caps', () => {
  const TOO_LARGE = 'Too many assignments in one save. Split the change into smaller saves.'

  function additions(n: number) {
    return Array.from({ length: n }, (_, i) => ({ ...VALID_ADDITION, slot_index: i + 1 }))
  }

  it('rejects more than 500 additions with a distinct message, without calling the RPC', async () => {
    const result = await saveAssignments('acme', TENANT_ID, additions(501), [])

    expect(result.error).toBe(TOO_LARGE)
    expect(result.error).not.toBe('Invalid request')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts exactly 500 additions — the cap is inclusive', async () => {
    rpc.mockReturnValue(rpcResult({ data: [] }))

    const result = await saveAssignments('acme', TENANT_ID, additions(500), [])

    expect(result.error).toBeUndefined()
    expect(rpc).toHaveBeenCalled()
  })

  it('rejects more than 5000 deletions', async () => {
    const ids = Array.from({ length: 5001 }, () => ASSIGNMENT_ID)

    const result = await saveAssignments('acme', TENANT_ID, [], ids)

    expect(result.error).toBe(TOO_LARGE)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects more than 500 status updates', async () => {
    const updates = Array.from({ length: 501 }, () => ({
      id: ASSIGNMENT_ID,
      status: 'available' as AssignmentStatus,
    }))

    const result = await saveAssignments('acme', TENANT_ID, [], [], updates)

    expect(result.error).toBe(TOO_LARGE)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps the RPC ASG04 errcode for callers that bypass this action', async () => {
    rpc.mockReturnValue(rpcResult({ error: { code: 'ASG04', message: 'whatever' } }))

    const result = await saveAssignments('acme', TENANT_ID, [VALID_ADDITION], [])

    expect(result.error).toBe(TOO_LARGE)
    expect(loggerWarn).toHaveBeenCalled()
  })

  it('does not throw when an array argument is null rather than an array', async () => {
    const result = await saveAssignments(
      'acme',
      TENANT_ID,
      null as unknown as (typeof VALID_ADDITION)[],
      []
    )

    expect(result.error).toBe('Invalid request')
    expect(rpc).not.toHaveBeenCalled()
  })
})

// Peter's call of 2026-10-07: an assignment may not be created over a period
// marked as time off. The block lives here rather than in a DB constraint
// (see migration 20261006113036's header), which makes this action the only
// thing enforcing it — a UI-only block would be bypassed by any direct call.
describe('saveAssignments time-off block', () => {
  const overlapping = [
    {
      official_id: OFFICIAL_ID,
      starts_at: '2026-09-01T07:00:00+00:00',
      ends_at: '2026-09-01T12:00:00+00:00',
    },
  ]

  it('refuses an addition that lands on declared time off', async () => {
    from.mockReturnValue(timeOffRows(overlapping))

    const result = await saveAssignments('viadal', TENANT_ID, [VALID_ADDITION], [])

    // The resolved string, not the key: tError translates before returning.
    // Asserting the text also proves the locale key is present in en.
    expect(result.error).toBe('That official has time off then and cannot be scheduled.')
    // The whole batch is rejected before the RPC — nothing partially applied.
    expect(rpc).not.toHaveBeenCalled()
  })

  it('matches across the timestamp shapes PostgREST and the grid produce', async () => {
    // The period comes back as `+00:00` and the addition arrives as `.000Z`.
    // Comparing those as strings gets the overlap wrong, because `+` sorts
    // below `.` — this pins the instant comparison.
    from.mockReturnValue(timeOffRows(overlapping))

    const result = await saveAssignments('viadal', TENANT_ID, [VALID_ADDITION], [])

    expect(result.error).toBe('That official has time off then and cannot be scheduled.')
  })

  it('allows an addition that merely touches the end of a period', async () => {
    // Half-open: an absence ending 08:00 and a shift starting 08:00 are
    // adjacent, not in conflict.
    from.mockReturnValue(
      timeOffRows([
        {
          official_id: OFFICIAL_ID,
          starts_at: '2026-09-01T06:00:00+00:00',
          ends_at: '2026-09-01T08:00:00+00:00',
        },
      ])
    )
    rpc.mockReturnValue(rpcResult({ data: [] }))

    const result = await saveAssignments('viadal', TENANT_ID, [VALID_ADDITION], [])

    expect(result.error).toBeUndefined()
    expect(rpc).toHaveBeenCalled()
  })

  it('ignores time off belonging to a different official', async () => {
    from.mockReturnValue(
      timeOffRows([
        {
          official_id: '99999999-9999-4999-8999-999999999999',
          starts_at: '2026-09-01T07:00:00+00:00',
          ends_at: '2026-09-01T12:00:00+00:00',
        },
      ])
    )
    rpc.mockReturnValue(rpcResult({ data: [] }))

    const result = await saveAssignments('viadal', TENANT_ID, [VALID_ADDITION], [])

    expect(result.error).toBeUndefined()
  })

  it('does not run the check — or block — when there are only deletions', async () => {
    // Removing an assignment that sits on time off is exactly how an admin
    // cleans up an overlap recorded after the fact, so deletions must pass.
    rpc.mockReturnValue(rpcResult({ data: [] }))

    const result = await saveAssignments('viadal', TENANT_ID, [], [ASSIGNMENT_ID])

    expect(result.error).toBeUndefined()
    expect(from).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalled()
  })

  it('fails closed when the time-off read errors', async () => {
    // Unlike every other read in this codebase, an unknown answer here must
    // not degrade to "no time off" — that would let the save through exactly
    // when the guard is broken.
    from.mockReturnValue(timeOffRows([], { message: 'boom' }))

    const result = await saveAssignments('viadal', TENANT_ID, [VALID_ADDITION], [])

    expect(result.error).toBe('Failed to save assignments. Please try again.')
    expect(rpc).not.toHaveBeenCalled()
    expect(loggerError).toHaveBeenCalled()
  })
})

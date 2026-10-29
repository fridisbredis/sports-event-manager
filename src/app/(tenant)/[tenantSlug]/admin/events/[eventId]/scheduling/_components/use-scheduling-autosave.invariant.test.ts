import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { useSchedulingAutosave } from './use-scheduling-autosave'
import { saveAssignments } from '../actions'
import type { AssignmentData, LocalAssignment } from './scheduling-types'

// Round-trip invariants on the assignment state (N12b).
//
// The example tests in use-scheduling-autosave.test.ts cover each handler's
// happy path one call at a time. These cover the properties that must hold
// across a SEQUENCE of calls — assign then unassign, paint then remove — which
// is where the stale-state bugs we have actually shipped lived: the grid
// disagreeing with the database after a round trip, rather than any single
// call being wrong.

vi.mock('next/navigation', () => ({ useRouter: vi.fn() }))

vi.mock('../actions', async () => {
  const actual = await vi.importActual<typeof import('../actions')>('../actions')
  return { ...actual, saveAssignments: vi.fn() }
})

vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }))

const BASE_ARGS = {
  tenantSlug: 'acme',
  tenantId: 'tenant-1',
  granularityMin: 15,
  initialAssignments: [] as AssignmentData[],
  beginPending: vi.fn(),
  endPending: vi.fn(),
}

function mockRouter() {
  const refresh = vi.fn()
  vi.mocked(useRouter).mockReturnValue({ refresh } as never)
  return { refresh }
}

/**
 * A stand-in server that assigns ids the way the real insert does, so a
 * round trip through persistAdditions produces distinct rows.
 */
function mockServerInserts() {
  let n = 0
  vi.mocked(saveAssignments).mockImplementation(
    async (_slug, _tenant, additions: Parameters<typeof saveAssignments>[2], _deletions) =>
      ({
        inserted: (additions ?? []).map((a) => ({
          id: `srv-${++n}`,
          official_id: a.official_id,
          workstation_id: a.workstation_id,
          timeslot_start: a.timeslot_start,
          slot_index: a.slot_index,
        })),
      }) as never
  )
}

/** The identity of an assignment as the grid renders it — ignoring the row id. */
function cellIdentity(a: LocalAssignment): string {
  return `${a.official_id}|${a.workstation_id}|${a.timeslot_start}|${a.slot_index}`
}

function identities(assignments: LocalAssignment[]): string[] {
  return assignments.map(cellIdentity).sort()
}

const SLOT = '2026-08-31T09:00:00.000Z'
const SLOT_END = '2026-08-31T09:15:00.000Z'
const OTHER_SLOT = '2026-08-31T09:15:00.000Z'
const OTHER_SLOT_END = '2026-08-31T09:30:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assignment round-trip invariants', () => {
  it('returns to the starting state after assign then unassign', async () => {
    mockRouter()
    mockServerInserts()

    const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))
    const before = identities(result.current.assignments)

    await act(async () => {
      await result.current.addAssignment('ws1', 1, SLOT, SLOT_END, 'o1')
    })
    expect(result.current.assignments).toHaveLength(1)

    const added = result.current.assignments[0]
    await act(async () => {
      await result.current.handleWsSlotRemove(added)
    })

    expect(identities(result.current.assignments)).toEqual(before)
  })

  it('leaves every other assignment untouched when one is removed', async () => {
    mockRouter()
    mockServerInserts()

    const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))

    // Deliberately adversarial: every one of these shares at least two fields
    // with the removal target, so a match on any PROPER SUBSET of
    // (official, station, time, index) takes a neighbour with it.
    //
    // The double-booking case is the one that matters in practice — the same
    // person on two work areas in one slot is exactly what the grid's
    // double-booked warning exists to show, so it is a state admins reach and
    // then edit. Removing one of the two must not silently clear both.
    await act(async () => {
      await result.current.addAssignment('ws1', 1, SLOT, SLOT_END, 'o1') // target
      await result.current.addAssignment('ws2', 1, SLOT, SLOT_END, 'o1') // same person+time
      await result.current.addAssignment('ws1', 2, SLOT, SLOT_END, 'o2') // same station+time
      await result.current.addAssignment('ws1', 1, OTHER_SLOT, OTHER_SLOT_END, 'o1') // same but later
    })
    expect(result.current.assignments).toHaveLength(4)

    const target = result.current.assignments.find(
      (a) =>
        a.official_id === 'o1' &&
        a.workstation_id === 'ws1' &&
        a.timeslot_start === SLOT &&
        a.slot_index === 1
    )!
    const survivors = identities(result.current.assignments.filter((a) => a !== target))

    await act(async () => {
      await result.current.handleWsSlotRemove(target)
    })

    expect(result.current.assignments).toHaveLength(3)
    expect(identities(result.current.assignments)).toEqual(survivors)
  })

  it('never issues two assignments the same slot_index at one station and time', async () => {
    mockRouter()
    mockServerInserts()

    const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))

    // A person-paint across one slot, repeated for several people. Each pick
    // has to take the next free index at that station, not reuse index 1 —
    // nextLocalFreeSlot is threaded through the batch precisely because the
    // state has not updated yet when the next cell is computed.
    await act(async () => {
      await result.current.handlePersonPaint('o1', 'ws1', [SLOT])
    })
    await act(async () => {
      await result.current.handlePersonPaint('o2', 'ws1', [SLOT])
    })
    await act(async () => {
      await result.current.handlePersonPaint('o3', 'ws1', [SLOT])
    })

    const indices = result.current.assignments
      .filter((a) => a.workstation_id === 'ws1' && a.timeslot_start === SLOT)
      .map((a) => a.slot_index)

    expect(indices).toHaveLength(3)
    expect(new Set(indices).size).toBe(3)
  })

  it('gives each cell of a multi-slot person paint its own free index', async () => {
    mockRouter()
    mockServerInserts()

    const slots = [SLOT, '2026-08-31T09:15:00.000Z', '2026-08-31T09:30:00.000Z']

    // One station already occupied at the MIDDLE slot only, so a paint across
    // the run cannot use the same index for every cell.
    const occupied: AssignmentData[] = [
      {
        id: 'existing',
        official_id: 'other',
        workstation_id: 'ws1',
        timeslot_start: slots[1],
        timeslot_end: slots[2],
        status: 'assigned',
        slot_index: 1,
      } as AssignmentData,
    ]

    mockRouter()
    mockServerInserts()
    const { result } = renderHook(() =>
      useSchedulingAutosave({ ...BASE_ARGS, initialAssignments: occupied })
    )

    await act(async () => {
      await result.current.handlePersonPaint('o1', 'ws1', slots)
    })

    // Every (station, slot start) pair must still hold distinct indices.
    const seen = new Map<string, Set<number>>()
    for (const a of result.current.assignments) {
      const key = `${a.workstation_id}|${a.timeslot_start}`
      const set = seen.get(key) ?? new Set<number>()
      expect(set.has(a.slot_index!), `duplicate slot_index ${a.slot_index} at ${key}`).toBe(false)
      set.add(a.slot_index!)
      seen.set(key, set)
    }

    // And the painted person is present in all three slots.
    const painted = result.current.assignments.filter((a) => a.official_id === 'o1')
    expect(painted.map((a) => a.timeslot_start).sort()).toEqual([...slots].sort())
  })

  it('discards local edits when the server prop resyncs, rather than merging them', async () => {
    // The resync path exists because local state went stale against the DB
    // (two shipped bugs). The invariant: after a resync the hook reflects the
    // SERVER list exactly — no local leftovers surviving alongside it.
    mockRouter()
    mockServerInserts()

    const { result, rerender } = renderHook((props: { initialAssignments: AssignmentData[] }) =>
      useSchedulingAutosave({ ...BASE_ARGS, ...props })
    )

    await act(async () => {
      await result.current.addAssignment('ws1', 1, SLOT, SLOT_END, 'o1')
    })
    expect(result.current.assignments).toHaveLength(1)

    const serverList: AssignmentData[] = [
      {
        id: 'srv-only',
        official_id: 'o9',
        workstation_id: 'ws9',
        timeslot_start: SLOT,
        timeslot_end: SLOT_END,
        status: 'assigned',
        slot_index: 1,
      } as AssignmentData,
    ]

    rerender({ initialAssignments: serverList })

    expect(result.current.assignments).toHaveLength(1)
    expect(result.current.assignments[0].official_id).toBe('o9')
  })
})

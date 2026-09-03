import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { useSchedulingAutosave } from './use-scheduling-autosave'
import { saveAssignments } from '../actions'
import { toastError } from '@/lib/toast'
import type { AssignmentData, LocalAssignment } from './scheduling-types'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))

vi.mock('../actions', async () => {
  const actual = await vi.importActual<typeof import('../actions')>('../actions')
  return {
    ...actual,
    saveAssignments: vi.fn(),
  }
})

vi.mock('@/lib/toast', () => ({
  toastError: vi.fn(),
}))

function mockRouter() {
  const refresh = vi.fn()
  vi.mocked(useRouter).mockReturnValue({ refresh } as never)
  return { refresh }
}

const BASE_ARGS = {
  tenantSlug: 'acme',
  tenantId: 'tenant-1',
  granularityMin: 15,
  initialAssignments: [] as AssignmentData[],
  beginPending: vi.fn(),
  endPending: vi.fn(),
}

function localAssignment(overrides: Partial<LocalAssignment> = {}): LocalAssignment {
  return {
    id: 'a1',
    official_id: 'o1',
    workstation_id: 'ws1',
    timeslot_start: '2026-08-31T09:00:00.000Z',
    timeslot_end: '2026-08-31T09:15:00.000Z',
    status: 'assigned',
    slot_index: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSchedulingAutosave', () => {
  describe('render-time resync', () => {
    it('reflects a new initialAssignments prop reference', () => {
      mockRouter()
      const first: AssignmentData[] = [
        {
          id: 'a1',
          official_id: 'o1',
          workstation_id: 'ws1',
          timeslot_start: '2026-08-31T09:00:00.000Z',
          timeslot_end: '2026-08-31T09:15:00.000Z',
          status: 'assigned',
          slot_index: 1,
        },
      ]
      const { result, rerender } = renderHook((props) => useSchedulingAutosave(props), {
        initialProps: { ...BASE_ARGS, initialAssignments: first },
      })
      expect(result.current.assignments).toHaveLength(1)

      const second: AssignmentData[] = []
      rerender({ ...BASE_ARGS, initialAssignments: second })
      expect(result.current.assignments).toHaveLength(0)
    })
  })

  describe('persistAdditions', () => {
    it('appends inserted assignments and refreshes on success', async () => {
      const { refresh } = mockRouter()
      vi.mocked(saveAssignments).mockResolvedValue({
        inserted: [
          {
            id: 'new1',
            official_id: 'o2',
            workstation_id: 'ws1',
            timeslot_start: '2026-08-31T09:00:00.000Z',
            slot_index: 1,
          },
        ],
      })
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))

      await act(async () => {
        await result.current.persistAdditions([
          {
            official_id: 'o2',
            workstation_id: 'ws1',
            timeslot_start: '2026-08-31T09:00:00.000Z',
            timeslot_end: '2026-08-31T09:15:00.000Z',
            slot_index: 1,
          },
        ])
      })

      expect(result.current.assignments).toHaveLength(1)
      expect(result.current.assignments[0].official_id).toBe('o2')
      expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('toasts the error and leaves state untouched on failure', async () => {
      const { refresh } = mockRouter()
      vi.mocked(saveAssignments).mockResolvedValue({ error: 'Someone else took that slot' })
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))

      await act(async () => {
        await result.current.persistAdditions([
          {
            official_id: 'o2',
            workstation_id: 'ws1',
            timeslot_start: '2026-08-31T09:00:00.000Z',
            timeslot_end: '2026-08-31T09:15:00.000Z',
            slot_index: 1,
          },
        ])
      })

      expect(toastError).toHaveBeenCalledWith('Someone else took that slot')
      expect(result.current.assignments).toHaveLength(0)
      expect(refresh).not.toHaveBeenCalled()
    })
  })

  describe('handleCellAction', () => {
    it('calls saveAssignments with a deletion for remove', async () => {
      mockRouter()
      vi.mocked(saveAssignments).mockResolvedValue({})
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))
      const assignment = localAssignment()

      await act(async () => {
        await result.current.handleCellAction('remove', assignment)
      })

      expect(saveAssignments).toHaveBeenCalledWith('acme', 'tenant-1', [], ['a1'])
      expect(BASE_ARGS.beginPending).toHaveBeenCalledWith('p:o1:2026-08-31T09:00:00.000Z')
      expect(BASE_ARGS.endPending).toHaveBeenCalledWith('p:o1:2026-08-31T09:00:00.000Z')
    })

    it('calls saveAssignments with a status update for assigned', async () => {
      mockRouter()
      vi.mocked(saveAssignments).mockResolvedValue({})
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))
      const assignment = localAssignment({ status: 'pending' })

      await act(async () => {
        await result.current.handleCellAction('assigned', assignment)
      })

      expect(saveAssignments).toHaveBeenCalledWith(
        'acme',
        'tenant-1',
        [],
        [],
        [{ id: 'a1', status: 'assigned' }]
      )
    })

    it('is a no-op when the assignment has no id', async () => {
      mockRouter()
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))

      await act(async () => {
        await result.current.handleCellAction('remove', localAssignment({ id: null }))
      })

      expect(saveAssignments).not.toHaveBeenCalled()
    })
  })

  describe('addAssignment', () => {
    it('skips the save when the slot is already taken locally', async () => {
      mockRouter()
      vi.mocked(saveAssignments).mockResolvedValue({
        inserted: [
          {
            id: 'a1',
            official_id: 'o1',
            workstation_id: 'ws1',
            timeslot_start: '2026-08-31T09:00:00.000Z',
            slot_index: 1,
          },
        ],
      })
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))

      // Seed local state via a successful persist first.
      await act(async () => {
        await result.current.persistAdditions([
          {
            official_id: 'o1',
            workstation_id: 'ws1',
            timeslot_start: '2026-08-31T09:00:00.000Z',
            timeslot_end: '2026-08-31T09:15:00.000Z',
            slot_index: 1,
          },
        ])
      })
      vi.mocked(saveAssignments).mockClear()

      await act(async () => {
        await result.current.addAssignment(
          'ws1',
          1,
          '2026-08-31T09:00:00.000Z',
          '2026-08-31T09:15:00.000Z',
          'o2'
        )
      })

      expect(saveAssignments).not.toHaveBeenCalled()
    })

    it('persists when the slot is free', async () => {
      mockRouter()
      vi.mocked(saveAssignments).mockResolvedValue({ inserted: [] })
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))

      await act(async () => {
        await result.current.addAssignment(
          'ws1',
          1,
          '2026-08-31T09:00:00.000Z',
          '2026-08-31T09:15:00.000Z',
          'o2'
        )
      })

      expect(saveAssignments).toHaveBeenCalledWith(
        'acme',
        'tenant-1',
        [
          {
            official_id: 'o2',
            workstation_id: 'ws1',
            timeslot_start: '2026-08-31T09:00:00.000Z',
            timeslot_end: '2026-08-31T09:15:00.000Z',
            slot_index: 1,
          },
        ],
        []
      )
    })
  })

  describe('handleWsSlotRemove', () => {
    it('removes the matching assignment on success', async () => {
      mockRouter()
      vi.mocked(saveAssignments)
        .mockResolvedValueOnce({
          inserted: [
            {
              id: 'a1',
              official_id: 'o1',
              workstation_id: 'ws1',
              timeslot_start: '2026-08-31T09:00:00.000Z',
              slot_index: 1,
            },
          ],
        })
        .mockResolvedValueOnce({})
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))

      await act(async () => {
        await result.current.persistAdditions([
          {
            official_id: 'o1',
            workstation_id: 'ws1',
            timeslot_start: '2026-08-31T09:00:00.000Z',
            timeslot_end: '2026-08-31T09:15:00.000Z',
            slot_index: 1,
          },
        ])
      })
      expect(result.current.assignments).toHaveLength(1)

      await act(async () => {
        await result.current.handleWsSlotRemove(result.current.assignments[0])
      })

      expect(result.current.assignments).toHaveLength(0)
    })

    it('is a no-op when the assignment has no id', async () => {
      mockRouter()
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))

      await act(async () => {
        await result.current.handleWsSlotRemove(localAssignment({ id: null }))
      })

      expect(saveAssignments).not.toHaveBeenCalled()
    })
  })

  describe('handleDragOfficialPick', () => {
    it('builds one addition per cell start and persists them as a batch', async () => {
      mockRouter()
      vi.mocked(saveAssignments).mockResolvedValue({ inserted: [] })
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))

      await act(async () => {
        await result.current.handleDragOfficialPick(
          {
            workstationId: 'ws1',
            slotIndex: 1,
            cellStarts: ['2026-08-31T09:00:00.000Z', '2026-08-31T09:15:00.000Z'],
            anchorTop: 0,
            anchorLeft: 0,
          },
          'o4'
        )
      })

      expect(saveAssignments).toHaveBeenCalledWith(
        'acme',
        'tenant-1',
        [
          {
            official_id: 'o4',
            workstation_id: 'ws1',
            timeslot_start: '2026-08-31T09:00:00.000Z',
            timeslot_end: '2026-08-31T09:15:00.000Z',
            slot_index: 1,
          },
          {
            official_id: 'o4',
            workstation_id: 'ws1',
            timeslot_start: '2026-08-31T09:15:00.000Z',
            timeslot_end: '2026-08-31T09:30:00.000Z',
            slot_index: 1,
          },
        ],
        []
      )
    })
  })

  describe('nextLocalFreeSlot', () => {
    it('returns 1 when no slot indices are used', () => {
      mockRouter()
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))
      expect(result.current.nextLocalFreeSlot([], 'ws1', '2026-08-31T09:00:00.000Z')).toBe(1)
    })

    it('returns the first gap in used slot indices for that workstation/time', () => {
      mockRouter()
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))
      const active = [localAssignment({ slot_index: 1 }), localAssignment({ slot_index: 2 })]
      expect(result.current.nextLocalFreeSlot(active, 'ws1', '2026-08-31T09:00:00.000Z')).toBe(3)
    })

    it('ignores assignments for a different workstation or slot start', () => {
      mockRouter()
      const { result } = renderHook(() => useSchedulingAutosave(BASE_ARGS))
      const active = [localAssignment({ workstation_id: 'other-ws', slot_index: 1 })]
      expect(result.current.nextLocalFreeSlot(active, 'ws1', '2026-08-31T09:00:00.000Z')).toBe(1)
    })
  })
})

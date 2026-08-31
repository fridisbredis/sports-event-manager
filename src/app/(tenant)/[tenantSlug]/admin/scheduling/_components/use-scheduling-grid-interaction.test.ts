import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSchedulingGridInteraction } from './use-scheduling-grid-interaction'

describe('useSchedulingGridInteraction', () => {
  describe('pickerCell', () => {
    it('starts null, opens, and closes', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      expect(result.current.pickerCell).toBeNull()

      act(() =>
        result.current.openPickerCell({
          officialId: 'o1',
          slotStart: '2026-08-31T09:00:00.000Z',
          anchorTop: 10,
          anchorLeft: 20,
        })
      )
      expect(result.current.pickerCell).toEqual({
        officialId: 'o1',
        slotStart: '2026-08-31T09:00:00.000Z',
        anchorTop: 10,
        anchorLeft: 20,
      })

      act(() => result.current.closePickerCell())
      expect(result.current.pickerCell).toBeNull()
    })
  })

  describe('cellActionCell', () => {
    it('starts null, opens, and closes', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      expect(result.current.cellActionCell).toBeNull()

      act(() =>
        result.current.openCellActionCell({
          assignments: [],
          labelBy: 'workArea',
          anchorTop: 1,
          anchorLeft: 2,
          anchorBottom: 3,
        })
      )
      expect(result.current.cellActionCell?.labelBy).toBe('workArea')

      act(() => result.current.closeCellActionCell())
      expect(result.current.cellActionCell).toBeNull()
    })
  })

  describe('expandedWorkAreas', () => {
    it('toggles membership independently per id', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      expect(result.current.expandedWorkAreas.size).toBe(0)

      act(() => result.current.toggleExpandedWorkArea('ws1'))
      expect(result.current.expandedWorkAreas.has('ws1')).toBe(true)

      act(() => result.current.toggleExpandedWorkArea('ws2'))
      expect(result.current.expandedWorkAreas.has('ws1')).toBe(true)
      expect(result.current.expandedWorkAreas.has('ws2')).toBe(true)

      act(() => result.current.toggleExpandedWorkArea('ws1'))
      expect(result.current.expandedWorkAreas.has('ws1')).toBe(false)
      expect(result.current.expandedWorkAreas.has('ws2')).toBe(true)
    })
  })

  describe('wsPickerCell', () => {
    it('starts null, opens, and closes', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      expect(result.current.wsPickerCell).toBeNull()

      act(() =>
        result.current.openWsPickerCell({
          workstationId: 'ws1',
          slotIndex: 1,
          slotStart: '2026-08-31T09:00:00.000Z',
          anchorTop: 1,
          anchorLeft: 2,
        })
      )
      expect(result.current.wsPickerCell?.workstationId).toBe('ws1')

      act(() => result.current.closeWsPickerCell())
      expect(result.current.wsPickerCell).toBeNull()
    })
  })

  describe('pendingCells', () => {
    it('adds and removes keys, tolerating duplicates and missing keys', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      expect(result.current.pendingCells.size).toBe(0)

      act(() => result.current.beginPending('p:o1:t1'))
      expect(result.current.pendingCells.has('p:o1:t1')).toBe(true)

      // Adding the same key twice is a no-op under Set semantics.
      act(() => result.current.beginPending('p:o1:t1'))
      expect(result.current.pendingCells.size).toBe(1)

      // Removing a key that isn't present doesn't throw or add anything.
      act(() => result.current.endPending('nonexistent'))
      expect(result.current.pendingCells.size).toBe(1)

      act(() => result.current.endPending('p:o1:t1'))
      expect(result.current.pendingCells.has('p:o1:t1')).toBe(false)
    })
  })

  describe('wsSlotModal', () => {
    it('opening resets the search string, closing also resets it', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      expect(result.current.wsSlotModal).toBeNull()
      expect(result.current.wsSlotModalSearch).toBe('')

      act(() =>
        result.current.openWsSlotModal({
          workstationId: 'ws1',
          wsName: 'Area 1',
          slotIndex: 1,
          slotStart: '2026-08-31T09:00:00.000Z',
          slotEnd: '2026-08-31T09:15:00.000Z',
        })
      )
      expect(result.current.wsSlotModal?.workstationId).toBe('ws1')
      expect(result.current.wsSlotModalSearch).toBe('')

      act(() => result.current.setWsSlotModalSearch('anna'))
      expect(result.current.wsSlotModalSearch).toBe('anna')

      // Re-opening resets a previously typed search string.
      act(() =>
        result.current.openWsSlotModal({
          workstationId: 'ws2',
          wsName: 'Area 2',
          slotIndex: 2,
          slotStart: '2026-08-31T10:00:00.000Z',
          slotEnd: '2026-08-31T10:15:00.000Z',
        })
      )
      expect(result.current.wsSlotModalSearch).toBe('')

      act(() => result.current.setWsSlotModalSearch('erik'))
      act(() => result.current.closeWsSlotModal())
      expect(result.current.wsSlotModal).toBeNull()
      expect(result.current.wsSlotModalSearch).toBe('')
    })
  })

  describe('wsDrag', () => {
    it('starts a drag with matching start/current index', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      expect(result.current.wsDrag).toBeNull()

      act(() => result.current.startWsDrag('ws1', 'Area 1', 1, 3))
      expect(result.current.wsDrag).toEqual({
        workstationId: 'ws1',
        wsName: 'Area 1',
        slotIndex: 1,
        startIdx: 3,
        currentIdx: 3,
      })
    })

    it('updateWsDragCurrent updates only when workstation and slot index match', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      act(() => result.current.startWsDrag('ws1', 'Area 1', 1, 3))

      act(() => result.current.updateWsDragCurrent('ws1', 1, 5))
      expect(result.current.wsDrag?.currentIdx).toBe(5)

      act(() => result.current.updateWsDragCurrent('other-ws', 1, 9))
      expect(result.current.wsDrag?.currentIdx).toBe(5)

      act(() => result.current.updateWsDragCurrent('ws1', 2, 9))
      expect(result.current.wsDrag?.currentIdx).toBe(5)
    })

    it('endWsDrag clears the drag state', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      act(() => result.current.startWsDrag('ws1', 'Area 1', 1, 3))
      act(() => result.current.endWsDrag())
      expect(result.current.wsDrag).toBeNull()
    })
  })

  describe('dragOfficialPicker', () => {
    it('starts null, opens, and closes', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      expect(result.current.dragOfficialPicker).toBeNull()

      act(() =>
        result.current.openDragOfficialPicker({
          workstationId: 'ws1',
          slotIndex: 1,
          cellStarts: ['2026-08-31T09:00:00.000Z'],
          anchorTop: 1,
          anchorLeft: 2,
        })
      )
      expect(result.current.dragOfficialPicker?.cellStarts).toEqual([
        '2026-08-31T09:00:00.000Z',
      ])

      act(() => result.current.closeDragOfficialPicker())
      expect(result.current.dragOfficialPicker).toBeNull()
    })
  })

  describe('dragSaving', () => {
    it('toggles as a plain boolean', () => {
      const { result } = renderHook(() => useSchedulingGridInteraction())
      expect(result.current.dragSaving).toBe(false)

      act(() => result.current.setDragSaving(true))
      expect(result.current.dragSaving).toBe(true)

      act(() => result.current.setDragSaving(false))
      expect(result.current.dragSaving).toBe(false)
    })
  })
})

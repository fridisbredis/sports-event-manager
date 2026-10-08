'use client'

import { useState, useEffect, useCallback } from 'react'
import type { LocalAssignment } from './scheduling-types'

export type PickerCell = {
  officialId: string
  slotStart: string
  anchorTop: number
  anchorLeft: number
} | null

export type CellActionCell = {
  assignments: LocalAssignment[]
  labelBy: 'workArea' | 'official'
  anchorTop: number
  anchorLeft: number
  anchorBottom: number
} | null

export type WsSlotModal = {
  workstationId: string
  wsName: string
  slotIndex: number
  slotStart: string
  slotEnd: string
} | null

type WsDrag = {
  workstationId: string
  wsName: string
  slotIndex: number
  startIdx: number
  currentIdx: number
} | null

/**
 * Drag-to-paint along ONE PERSON'S row in the by-person grid.
 *
 * Deliberately a separate state from `wsDrag` rather than a widened version of
 * it. That one paints down a numbered slot row of a single workstation, so it
 * is keyed by (workstationId, slotIndex) and asks "which official?" at the
 * end. This one paints across a person's timeline and already knows who — what
 * it asks at the end is "which work area, or time off?". Same gesture, two
 * different questions, and merging them would mean one state where half the
 * fields are null in either mode.
 */
export type PersonDrag = {
  officialId: string
  officialName: string
  startIdx: number
  currentIdx: number
} | null

/** What a finished person-row drag offers to fill the painted cells with. */
export type PersonDragPicker = {
  officialId: string
  officialName: string
  cellStarts: string[]
  anchorTop: number
  anchorLeft: number
} | null

export type DragOfficialPicker = {
  workstationId: string
  slotIndex: number
  cellStarts: string[]
  anchorTop: number
  anchorLeft: number
} | null

// The nine interaction-mode states for the scheduling grid, plus the
// click-outside effect that closes four of them. Business logic (API calls,
// assignment mutations) stays in scheduling-grid.tsx — this hook only owns
// state and the trivial open/close/update transitions around it.
export function useSchedulingGridInteraction() {
  const [pickerCell, setPickerCell] = useState<PickerCell>(null)
  const openPickerCell = useCallback((data: NonNullable<PickerCell>) => setPickerCell(data), [])
  const closePickerCell = useCallback(() => setPickerCell(null), [])

  const [cellActionCell, setCellActionCell] = useState<CellActionCell>(null)
  const openCellActionCell = useCallback(
    (data: NonNullable<CellActionCell>) => setCellActionCell(data),
    []
  )
  const closeCellActionCell = useCallback(() => setCellActionCell(null), [])

  const [expandedWorkAreas, setExpandedWorkAreas] = useState<Set<string>>(new Set())
  const toggleExpandedWorkArea = useCallback((wsId: string) => {
    setExpandedWorkAreas((prev) => {
      const next = new Set(prev)
      if (next.has(wsId)) next.delete(wsId)
      else next.add(wsId)
      return next
    })
  }, [])

  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set())
  const beginPending = useCallback((key: string) => {
    setPendingCells((prev) => new Set(prev).add(key))
  }, [])
  const endPending = useCallback((key: string) => {
    setPendingCells((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  const [wsSlotModal, setWsSlotModal] = useState<WsSlotModal>(null)
  const [wsSlotModalSearch, setWsSlotModalSearch] = useState('')
  const openWsSlotModal = useCallback((data: NonNullable<WsSlotModal>) => {
    setWsSlotModal(data)
    setWsSlotModalSearch('')
  }, [])
  const closeWsSlotModal = useCallback(() => {
    setWsSlotModal(null)
    setWsSlotModalSearch('')
  }, [])

  const [wsDrag, setWsDrag] = useState<WsDrag>(null)
  const startWsDrag = useCallback(
    (workstationId: string, wsName: string, slotIndex: number, idx: number) => {
      setWsDrag({ workstationId, wsName, slotIndex, startIdx: idx, currentIdx: idx })
    },
    []
  )
  const updateWsDragCurrent = useCallback((wsId: string, slotIndex: number, idx: number) => {
    setWsDrag((prev) => {
      if (!prev || prev.workstationId !== wsId || prev.slotIndex !== slotIndex) return prev
      if (prev.currentIdx === idx) return prev
      return { ...prev, currentIdx: idx }
    })
  }, [])
  const endWsDrag = useCallback(() => setWsDrag(null), [])

  const [personDrag, setPersonDrag] = useState<PersonDrag>(null)
  const startPersonDrag = useCallback(
    (officialId: string, officialName: string, idx: number) =>
      setPersonDrag({ officialId, officialName, startIdx: idx, currentIdx: idx }),
    []
  )
  const updatePersonDragCurrent = useCallback((officialId: string, idx: number) => {
    setPersonDrag((prev) => {
      if (!prev || prev.officialId !== officialId) return prev
      if (prev.currentIdx === idx) return prev
      return { ...prev, currentIdx: idx }
    })
  }, [])
  const endPersonDrag = useCallback(() => setPersonDrag(null), [])

  const [personDragPicker, setPersonDragPicker] = useState<PersonDragPicker>(null)
  const openPersonDragPicker = useCallback(
    (data: NonNullable<PersonDragPicker>) => setPersonDragPicker(data),
    []
  )
  const closePersonDragPicker = useCallback(() => setPersonDragPicker(null), [])

  const [dragOfficialPicker, setDragOfficialPicker] = useState<DragOfficialPicker>(null)
  const openDragOfficialPicker = useCallback(
    (data: NonNullable<DragOfficialPicker>) => setDragOfficialPicker(data),
    []
  )
  const closeDragOfficialPicker = useCallback(() => setDragOfficialPicker(null), [])

  const [dragSaving, setDragSaving] = useState(false)

  // Close popups when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerCell && !(e.target as HTMLElement).closest('[data-picker-cell]')) {
        setPickerCell(null)
      }
      if (cellActionCell && !(e.target as HTMLElement).closest('[data-cell-action]')) {
        setCellActionCell(null)
      }
      if (dragOfficialPicker && !(e.target as HTMLElement).closest('[data-drag-official-picker]')) {
        setDragOfficialPicker(null)
      }
      if (personDragPicker && !(e.target as HTMLElement).closest('[data-person-drag-picker]')) {
        setPersonDragPicker(null)
      }
    }
    if (pickerCell || cellActionCell || dragOfficialPicker || personDragPicker) {
      document.addEventListener('mousedown', handleClick)
    }
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pickerCell, cellActionCell, dragOfficialPicker, personDragPicker])

  return {
    pickerCell,
    openPickerCell,
    closePickerCell,

    cellActionCell,
    openCellActionCell,
    closeCellActionCell,

    expandedWorkAreas,
    toggleExpandedWorkArea,

    pendingCells,
    beginPending,
    endPending,

    wsSlotModal,
    openWsSlotModal,
    closeWsSlotModal,

    wsSlotModalSearch,
    setWsSlotModalSearch,

    wsDrag,
    startWsDrag,
    updateWsDragCurrent,
    endWsDrag,

    personDrag,
    startPersonDrag,
    updatePersonDragCurrent,
    endPersonDrag,

    personDragPicker,
    openPersonDragPicker,
    closePersonDragPicker,

    dragOfficialPicker,
    openDragOfficialPicker,
    closeDragOfficialPicker,

    dragSaving,
    setDragSaving,
  }
}

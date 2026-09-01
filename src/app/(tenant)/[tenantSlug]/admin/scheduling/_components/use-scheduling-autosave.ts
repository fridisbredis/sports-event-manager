'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveAssignments, type AssignmentInput } from '../actions'
import { slotEndTime } from '@/lib/scheduling/grid-logic'
import { toastError } from '@/lib/toast'
import { toLocalAssignments, applyCellAction } from './grid-helpers'
import type { AssignmentData, LocalAssignment } from './scheduling-types'
import type { WsPickerCell, DragOfficialPicker } from './use-scheduling-grid-interaction'

function toLocalAssignmentsFromInitial(initialAssignments: AssignmentData[]): LocalAssignment[] {
  return initialAssignments
    .filter((a) => a.workstation_id)
    .map((a) => ({
      id: a.id,
      official_id: a.official_id,
      workstation_id: a.workstation_id!,
      timeslot_start: new Date(a.timeslot_start).toISOString(),
      timeslot_end: new Date(a.timeslot_end).toISOString(),
      status: a.status ?? 'assigned',
      slot_index: a.slot_index,
    }))
}

function personCellKey(officialId: string, slotStart: string): string {
  return `p:${officialId}:${slotStart}`
}

function wsCellKey(workstationId: string, slotIndex: number | null, slotStart: string): string {
  return `w:${workstationId}:${slotIndex}:${slotStart}`
}

interface UseSchedulingAutosaveArgs {
  tenantSlug: string
  tenantId: string
  granularityMin: number
  initialAssignments: AssignmentData[]
  beginPending: (key: string) => void
  endPending: (key: string) => void
}

// Owns the assignments produced/consumed by autosave and the API-calling
// mutation handlers around them. UI-state orchestration (closing popups,
// toggling drag-saving indicators) stays in scheduling-grid.tsx — this hook
// only persists and reflects the result in local state.
export function useSchedulingAutosave({
  tenantSlug,
  tenantId,
  granularityMin,
  initialAssignments,
  beginPending,
  endPending,
}: UseSchedulingAutosaveArgs) {
  const router = useRouter()

  const [assignments, setAssignments] = useState<LocalAssignment[]>(() =>
    toLocalAssignmentsFromInitial(initialAssignments)
  )

  // `initialAssignments` is a new array on every server re-render (e.g. after
  // router.refresh()), but useState only reads it once at mount — without this,
  // local state goes stale relative to the DB and autosave rejects edits to
  // cells that look empty but are already taken. Resyncing during render
  // (rather than in an effect) avoids an extra cascading render and still
  // preserves unrelated local UI state (pickerCell, expandedWorkAreas, etc.)
  // that a remount-by-key approach would lose.
  const [prevInitialAssignments, setPrevInitialAssignments] = useState(initialAssignments)
  if (initialAssignments !== prevInitialAssignments) {
    setPrevInitialAssignments(initialAssignments)
    setAssignments(toLocalAssignmentsFromInitial(initialAssignments))
  }

  function nextLocalFreeSlot(
    activeAssignments: LocalAssignment[],
    wsId: string,
    slotStart: string
  ): number {
    const used = new Set<number>()
    for (const a of activeAssignments) {
      if (a.workstation_id === wsId && a.timeslot_start === slotStart && a.slot_index !== null) {
        used.add(a.slot_index)
      }
    }
    let idx = 1
    while (used.has(idx)) idx++
    return idx
  }

  async function persistAdditions(additions: AssignmentInput[]) {
    const result = await saveAssignments(tenantSlug, tenantId, additions, [])
    if (result.error) {
      toastError(result.error)
      return
    }
    setAssignments((prev) => [
      ...prev,
      ...toLocalAssignments(result.inserted ?? [], granularityMin),
    ])
    router.refresh()
  }

  async function handleCellAction(action: 'remove' | 'assigned', assignment: LocalAssignment) {
    if (!assignment.id) return

    const key = personCellKey(assignment.official_id, assignment.timeslot_start)
    beginPending(key)
    const result =
      action === 'remove'
        ? await saveAssignments(tenantSlug, tenantId, [], [assignment.id])
        : await saveAssignments(
            tenantSlug,
            tenantId,
            [],
            [],
            [{ id: assignment.id, status: action }]
          )
    endPending(key)

    if (result.error) {
      toastError(result.error)
      return
    }

    setAssignments((prev) => applyCellAction(prev, action, assignment.id!))
    router.refresh()
  }

  async function handleWsPersonPick(wsPickerCell: NonNullable<WsPickerCell>, officialId: string) {
    const { workstationId, slotIndex, slotStart } = wsPickerCell
    const slot = new Date(slotStart)
    const slotEnd = slotEndTime(slot, granularityMin).toISOString()

    const key = wsCellKey(workstationId, slotIndex, slotStart)
    beginPending(key)
    await persistAdditions([
      {
        official_id: officialId,
        workstation_id: workstationId,
        timeslot_start: slotStart,
        timeslot_end: slotEnd,
        slot_index: slotIndex,
      },
    ])
    endPending(key)
  }

  async function addAssignment(
    workstationId: string,
    slotIndex: number,
    slotStart: string,
    slotEnd: string,
    officialId: string
  ) {
    const slotTaken = assignments.some(
      (a) =>
        a.workstation_id === workstationId &&
        a.slot_index === slotIndex &&
        a.timeslot_start === slotStart
    )
    if (slotTaken) return

    const key = wsCellKey(workstationId, slotIndex, slotStart)
    beginPending(key)
    await persistAdditions([
      {
        official_id: officialId,
        workstation_id: workstationId,
        timeslot_start: slotStart,
        timeslot_end: slotEnd,
        slot_index: slotIndex,
      },
    ])
    endPending(key)
  }

  // Persists a drag-to-paint batch immediately (rather than leaving it in
  // local state for the manual Save button) so a slot-collision from another
  // admin only affects this small batch, not every other pending edit on the
  // page — and so a big drag doesn't silently discard its own valid cells if
  // just one of them collides.
  async function handleDragOfficialPick(
    dragOfficialPicker: NonNullable<DragOfficialPicker>,
    officialId: string
  ) {
    const { workstationId, slotIndex, cellStarts } = dragOfficialPicker

    const additions: AssignmentInput[] = cellStarts.map((slotStart) => ({
      official_id: officialId,
      workstation_id: workstationId,
      timeslot_start: slotStart,
      timeslot_end: slotEndTime(new Date(slotStart), granularityMin).toISOString(),
      slot_index: slotIndex,
    }))

    await persistAdditions(additions)
  }

  async function handleWsSlotRemove(assignment: LocalAssignment) {
    if (!assignment.id) return

    const key = wsCellKey(
      assignment.workstation_id,
      assignment.slot_index,
      assignment.timeslot_start
    )
    beginPending(key)
    const result = await saveAssignments(tenantSlug, tenantId, [], [assignment.id])
    endPending(key)

    if (result.error) {
      toastError(result.error)
      return
    }

    setAssignments((prev) =>
      prev.filter(
        (a) =>
          !(
            a.official_id === assignment.official_id &&
            a.workstation_id === assignment.workstation_id &&
            a.timeslot_start === assignment.timeslot_start &&
            a.slot_index === assignment.slot_index
          )
      )
    )
    router.refresh()
  }

  return {
    assignments,
    nextLocalFreeSlot,
    persistAdditions,
    handleCellAction,
    handleWsPersonPick,
    addAssignment,
    handleDragOfficialPick,
    handleWsSlotRemove,
  }
}

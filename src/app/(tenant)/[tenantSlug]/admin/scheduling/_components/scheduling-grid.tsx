'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/react'
import { saveAssignments, type AssignmentInput } from '../actions'
import { getAllocableDays } from '@/lib/scheduling/allocable-range'
import {
  getCurrentStage,
  generateSlotsForDay,
  slotEndTime,
  isWithinWindow,
  formatDayLabel,
  computeOverCapacityCells,
  computeOverCapacityDetails,
  computeDoubleBookedOfficials,
  computeDoubleBookedDetails,
} from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { toLocalAssignments, getAssignmentsForCell, applyCellAction } from './grid-helpers'
import { SetupEmptyState } from './setup-empty-state'
import { SchedulingLegend } from './scheduling-legend'
import { ByPersonGrid } from './by-person-grid'
import { ByWorkAreaGrid } from './by-work-area-grid'
import { useSchedulingGridInteraction } from './use-scheduling-grid-interaction'
import { CellActionPopup } from './cell-action-popup'
import { WsPersonPicker } from './ws-person-picker'
import { DragOfficialPicker } from './drag-official-picker'
import { WsSlotModal } from './ws-slot-modal'
import type {
  Stage,
  WorkstationData,
  OfficialData,
  AssignmentData,
  LocalAssignment,
} from './scheduling-types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  tenantSlug: string
  tenantId: string
  eventId: string
  granularityMin: number
  stages: Stage[]
  workstations: WorkstationData[]
  officials: OfficialData[]
  initialAssignments: AssignmentData[]
  initialSelectedDay: string
}

type View = 'by-person' | 'by-work-area'

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

// ─── Component ───────────────────────────────────────────────────────────────

export function SchedulingGrid({
  tenantSlug,
  tenantId,
  granularityMin,
  stages,
  workstations,
  officials,
  initialAssignments,
  initialSelectedDay,
}: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const [selectedStageId, setSelectedStageId] = useState<string>(
    () => getCurrentStage(stages)?.id ?? stages[0]?.id ?? ''
  )
  const [view, setView] = useState<View>('by-person')
  const [selectedDay, setSelectedDay] = useState<string>(initialSelectedDay)

  // The assignments the server sent are scoped to `initialSelectedDay` — when the
  // user picks a different day, push it into the URL so the server re-fetches
  // that day's assignments instead of the client trying to slice a broader set
  // it never received.
  function changeDay(day: string) {
    setSelectedDay(day)
    router.push(`?day=${day}`, { scroll: false })
  }
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
  const {
    pickerCell,
    openPickerCell,
    closePickerCell,
    cellActionCell,
    openCellActionCell,
    closeCellActionCell,
    expandedWorkAreas,
    toggleExpandedWorkArea,
    wsPickerCell,
    closeWsPickerCell,
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
    dragOfficialPicker,
    openDragOfficialPicker,
    closeDragOfficialPicker,
    dragSaving,
    setDragSaving,
  } = useSchedulingGridInteraction()

  function personCellKey(officialId: string, slotStart: string): string {
    return `p:${officialId}:${slotStart}`
  }

  function wsCellKey(workstationId: string, slotIndex: number | null, slotStart: string): string {
    return `w:${workstationId}:${slotIndex}:${slotStart}`
  }

  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? stages[0]

  const availableDays = useMemo(
    () => (selectedStage ? getAllocableDays(selectedStage) : []),
    [selectedStage]
  )

  const dayIndex = availableDays.indexOf(selectedDay)

  const slots = useMemo(
    () =>
      selectedStage && selectedDay
        ? generateSlotsForDay(selectedStage, selectedDay, granularityMin)
        : [],
    [selectedStage, selectedDay, granularityMin]
  )

  const stageWorkstations = useMemo(
    () => workstations.filter((w) => w.stage_id === selectedStageId),
    [workstations, selectedStageId]
  )

  // ─── Derived conflict data ────────────────────────────────────────────────

  const activeAssignments = useMemo(() => {
    const stageWsIds = new Set(stageWorkstations.map((w) => w.id))
    return assignments.filter((a) => stageWsIds.has(a.workstation_id))
  }, [assignments, stageWorkstations])

  const overCapacityCells = useMemo(
    () => computeOverCapacityCells(activeAssignments, stageWorkstations),
    [activeAssignments, stageWorkstations]
  )

  const doubleBookedOfficials = useMemo(
    () => computeDoubleBookedOfficials(assignments),
    [assignments]
  )

  const overCapacityCount = useMemo(() => {
    const wsSet = new Set<string>()
    for (const key of overCapacityCells) wsSet.add(key.split(':')[0])
    return wsSet.size
  }, [overCapacityCells])

  const doubleBookedCount = useMemo(() => {
    const officialSet = new Set<string>()
    for (const key of doubleBookedOfficials) officialSet.add(key.split(':')[0])
    return officialSet.size
  }, [doubleBookedOfficials])

  const doubleBookedDetails = useMemo(
    () => computeDoubleBookedDetails(doubleBookedOfficials, assignments, officials, workstations),
    [doubleBookedOfficials, assignments, officials, workstations]
  )

  const overCapacityDetails = useMemo(
    () =>
      computeOverCapacityDetails(
        overCapacityCells,
        activeAssignments,
        stageWorkstations,
        officials
      ),
    [overCapacityCells, activeAssignments, stageWorkstations, officials]
  )

  const handleWsExpandedSlotClick = useCallback(
    (wsId: string, wsName: string, slotIndex: number, slot: Date) => {
      const slotEnd = slotEndTime(slot, granularityMin).toISOString()
      openWsSlotModal({
        workstationId: wsId,
        wsName,
        slotIndex,
        slotStart: slot.toISOString(),
        slotEnd,
      })
    },
    [granularityMin, openWsSlotModal]
  )

  // Finalize a by-work-area drag on mouseup (window-level so it can't get stuck
  // if the mouse leaves the table before releasing). The listener re-subscribes
  // whenever `wsDrag` changes (it's in the dependency array below), so reading
  // it directly here always sees the current value — no functional-updater
  // needed to avoid a stale closure.
  useEffect(() => {
    if (!wsDrag) return

    function handleUp(e: PointerEvent) {
      if (!wsDrag) return
      const { workstationId, wsName, slotIndex, startIdx, currentIdx } = wsDrag
      const lo = Math.min(startIdx, currentIdx)
      const hi = Math.max(startIdx, currentIdx)
      endWsDrag()

      if (lo === hi) {
        // No movement — treat as an ordinary click on a single slot.
        const slot = slots[lo]
        if (slot) handleWsExpandedSlotClick(workstationId, wsName, slotIndex, slot)
        return
      }

      const ws = stageWorkstations.find((w) => w.id === workstationId)
      const validCells: string[] = []
      for (let i = lo; i <= hi; i++) {
        const slot = slots[i]
        if (!slot) continue
        if (ws && !isWithinWindow(slot, granularityMin, ws.workstation_operating_windows)) continue
        const slotStart = slot.toISOString()
        const occupied = activeAssignments.some(
          (a) =>
            a.workstation_id === workstationId &&
            a.slot_index === slotIndex &&
            a.timeslot_start === slotStart
        )
        if (occupied) continue
        validCells.push(slotStart)
      }

      if (validCells.length > 0) {
        openDragOfficialPicker({
          workstationId,
          slotIndex,
          cellStarts: validCells,
          anchorTop: e.clientY,
          anchorLeft: e.clientX,
        })
      }
    }

    window.addEventListener('pointerup', handleUp)
    return () => window.removeEventListener('pointerup', handleUp)
  }, [
    wsDrag,
    slots,
    stageWorkstations,
    granularityMin,
    activeAssignments,
    handleWsExpandedSlotClick,
    endWsDrag,
    openDragOfficialPicker,
  ])

  const dragAvailableOfficials = useMemo(() => {
    if (!dragOfficialPicker) return []
    const busy = new Set(
      activeAssignments
        .filter((a) => dragOfficialPicker.cellStarts.includes(a.timeslot_start))
        .map((a) => a.official_id)
    )
    return officials.filter((o) => !busy.has(o.id))
  }, [dragOfficialPicker, activeAssignments, officials])

  // ─── Handlers ────────────────────────────────────────────────────────────

  function nextLocalFreeSlot(wsId: string, slotStart: string): number {
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

  async function handleCellClick(
    officialId: string,
    slot: Date,
    ws?: WorkstationData,
    anchor?: HTMLElement
  ) {
    const slotStart = slot.toISOString()
    const existing = getAssignmentsForCell(assignments, officialId, slotStart)

    if (existing.length > 0 && !ws) {
      const rect = anchor?.getBoundingClientRect()
      openCellActionCell({
        assignments: existing,
        labelBy: 'workArea',
        anchorTop: rect ? rect.top : 0,
        anchorLeft: rect ? rect.left : 0,
        anchorBottom: rect ? rect.bottom : 0,
      })
    } else if (ws) {
      const slotEnd = slotEndTime(slot, granularityMin).toISOString()
      const slotIdx = nextLocalFreeSlot(ws.id, slotStart)
      closePickerCell()

      const key = personCellKey(officialId, slotStart)
      beginPending(key)
      await persistAdditions([
        {
          official_id: officialId,
          workstation_id: ws.id,
          timeslot_start: slotStart,
          timeslot_end: slotEnd,
          slot_index: slotIdx,
        },
      ])
      endPending(key)
    } else {
      const rect = anchor?.getBoundingClientRect()
      openPickerCell({
        officialId,
        slotStart,
        anchorTop: rect ? rect.top : 0,
        anchorLeft: rect ? rect.left : 0,
      })
    }
  }

  async function handleCellAction(action: 'remove' | 'assigned', assignment: LocalAssignment) {
    closeCellActionCell()
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

  async function handleWsPersonPick(officialId: string) {
    if (!wsPickerCell) return
    const { workstationId, slotIndex, slotStart } = wsPickerCell
    const slot = new Date(slotStart)
    const slotEnd = slotEndTime(slot, granularityMin).toISOString()
    closeWsPickerCell()

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

  function handleOverflowClick(overflowAssignments: LocalAssignment[], anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect()
    openCellActionCell({
      assignments: overflowAssignments,
      labelBy: 'official',
      anchorTop: rect.top,
      anchorLeft: rect.left,
      anchorBottom: rect.bottom,
    })
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

  function handleWsSlotAdd(officialId: string) {
    if (!wsSlotModal) return
    const { workstationId, slotIndex, slotStart, slotEnd } = wsSlotModal
    closeWsSlotModal()
    addAssignment(workstationId, slotIndex, slotStart, slotEnd, officialId)
  }

  // ─── Drag-to-paint (by-work-area, expanded numbered slot rows) ───────────

  function handleWsDragStart(wsId: string, wsName: string, slotIndex: number, idx: number) {
    if (dragSaving) return
    startWsDrag(wsId, wsName, slotIndex, idx)
  }

  function handleWsDragEnter(wsId: string, slotIndex: number, idx: number) {
    updateWsDragCurrent(wsId, slotIndex, idx)
  }

  // Persists a drag-to-paint batch immediately (rather than leaving it in
  // local state for the manual Save button) so a slot-collision from another
  // admin only affects this small batch, not every other pending edit on the
  // page — and so a big drag doesn't silently discard its own valid cells if
  // just one of them collides.
  async function handleDragOfficialPick(officialId: string) {
    if (!dragOfficialPicker) return
    const { workstationId, slotIndex, cellStarts } = dragOfficialPicker
    closeDragOfficialPicker()
    setDragSaving(true)

    const additions: AssignmentInput[] = cellStarts.map((slotStart) => ({
      official_id: officialId,
      workstation_id: workstationId,
      timeslot_start: slotStart,
      timeslot_end: slotEndTime(new Date(slotStart), granularityMin).toISOString(),
      slot_index: slotIndex,
    }))

    await persistAdditions(additions)

    setDragSaving(false)
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

  // ─── Render ───────────────────────────────────────────────────────────────

  if (stages.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-sm">{t('scheduling.noStages')}</p>
      </div>
    )
  }

  return (
    <div>
      <style>{`
        .print-only { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .scheduling-scroll-container {
            overflow: visible !important;
            max-height: none !important;
          }
          [data-picker-cell], [data-cell-action], [data-ws-picker], [role='dialog'] {
            display: none !important;
          }
          @page { size: landscape; }
        }
      `}</style>

      {/* Print-only header — replaces the interactive chrome when printing */}
      <div className="print-only mb-4">
        <h1 className="text-xl font-semibold text-gray-900">{t('scheduling.title')}</h1>
        <p className="text-sm text-gray-600">
          {selectedStage?.name}
          {selectedDay ? ` — ${formatDayLabel(selectedDay)}` : ''}
        </p>
      </div>

      {/* Header */}
      <div className="no-print flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t('scheduling.title')}</h1>

        <div className="flex-1" />

        {/* Stage + day selector — grouped together since they're one connected control */}
        <Dropdown>
          <DropdownTrigger>
            <Button
              variant="bordered"
              size="sm"
              endContent={
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              }
            >
              {selectedStage?.name ?? t('scheduling.selectStage')}
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            selectionMode="single"
            selectedKeys={new Set([selectedStageId])}
            onAction={(key) => {
              const id = String(key)
              const stage = stages.find((s) => s.id === id)
              if (stage) {
                setSelectedStageId(id)
                closePickerCell()
                closeCellActionCell()
                changeDay(getAllocableDays(stage)[0] ?? '')
              }
            }}
          >
            {stages.map((stage) => (
              <DropdownItem key={stage.id}>{stage.name}</DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>

        {availableDays.length > 0 && (
          <div className="flex items-center gap-1">
            <Button
              isIconOnly
              variant="bordered"
              size="sm"
              onPress={() => changeDay(availableDays[dayIndex - 1])}
              isDisabled={dayIndex <= 0}
              aria-label={t('scheduling.prevDay')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </Button>
            <span className="text-sm text-gray-600 border border-gray-200 rounded-md px-3 py-1.5 bg-white min-w-[200px] text-center capitalize">
              {selectedDay ? formatDayLabel(selectedDay) : ''}
            </span>
            <Button
              isIconOnly
              variant="bordered"
              size="sm"
              onPress={() => changeDay(availableDays[dayIndex + 1])}
              isDisabled={dayIndex >= availableDays.length - 1}
              aria-label={t('scheduling.nextDay')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Button>
          </div>
        )}

        {dragSaving && (
          <span className="text-xs text-gray-400">{t('scheduling.dragPaintSaving')}</span>
        )}

        <Button variant="bordered" size="sm" onPress={() => window.print()}>
          {t('scheduling.print')}
        </Button>
      </div>

      {/* Conflict banners */}
      {overCapacityCount > 0 && (
        <div className="no-print mb-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-md text-sm text-orange-700">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-orange-500 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z"
              />
            </svg>
            {t('scheduling.overCapacity', { count: overCapacityCount })}
          </div>
          <ul className="mt-1.5 ml-6 space-y-0.5 text-xs text-orange-600">
            {overCapacityDetails.map((d, i) => (
              <li key={i}>
                {d.workAreaName} — {d.time} ({d.count}/{d.ceiling}): {d.officialNames.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {doubleBookedCount > 0 && (
        <div className="no-print mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-red-500 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <path strokeLinecap="round" strokeWidth={2} d="M8 8l8 8M16 8l-8 8" />
            </svg>
            {t('scheduling.doubleBooked', { count: doubleBookedCount })}
          </div>
          <ul className="mt-1.5 ml-6 space-y-0.5 text-xs text-red-600">
            {doubleBookedDetails.map((d, i) => (
              <li key={i}>
                {d.officialName} — {d.time} ({d.workAreaNames.join(', ')})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* View toggle */}
      <div className="no-print flex gap-1 mb-5">
        <Button
          size="sm"
          color={view === 'by-person' ? 'primary' : 'default'}
          variant={view === 'by-person' ? 'solid' : 'bordered'}
          onPress={() => setView('by-person')}
        >
          {t('scheduling.viewByPerson')}
        </Button>
        <Button
          size="sm"
          color={view === 'by-work-area' ? 'primary' : 'default'}
          variant={view === 'by-work-area' ? 'solid' : 'bordered'}
          onPress={() => setView('by-work-area')}
        >
          {t('scheduling.viewByWorkArea')}
        </Button>
      </div>

      {/* Grid */}
      {officials.length === 0 && stageWorkstations.length === 0 ? (
        <SetupEmptyState />
      ) : slots.length === 0 ? (
        <div className="border border-gray-200 rounded-md bg-white py-12 text-center text-sm text-gray-500">
          {t('scheduling.noTimeRange')}
        </div>
      ) : view === 'by-person' ? (
        <ByPersonGrid
          slots={slots}
          granularityMin={granularityMin}
          officials={officials}
          stageWorkstations={stageWorkstations}
          activeAssignments={activeAssignments}
          doubleBookedOfficials={doubleBookedOfficials}
          pickerCell={pickerCell}
          onCellClick={handleCellClick}
          pendingCells={pendingCells}
        />
      ) : (
        <ByWorkAreaGrid
          slots={slots}
          granularityMin={granularityMin}
          officials={officials}
          stageWorkstations={stageWorkstations}
          activeAssignments={activeAssignments}
          overCapacityCells={overCapacityCells}
          expandedWorkAreas={expandedWorkAreas}
          pendingCells={pendingCells}
          onToggleExpand={toggleExpandedWorkArea}
          onWsExpandedSlotClick={handleWsExpandedSlotClick}
          onOverflowClick={handleOverflowClick}
          wsDrag={wsDrag}
          onWsDragStart={handleWsDragStart}
          onWsDragEnter={handleWsDragEnter}
          dragOfficialPicker={dragOfficialPicker}
        />
      )}

      {/* Action popup — status change / remove for an existing assignment */}
      {cellActionCell && (
        <CellActionPopup
          cellActionCell={cellActionCell}
          officials={officials}
          workstations={workstations}
          onAction={handleCellAction}
        />
      )}

      {/* Person picker for by-work-area expanded view */}
      {wsPickerCell && (
        <WsPersonPicker
          wsPickerCell={wsPickerCell}
          activeAssignments={activeAssignments}
          officials={officials}
          onPick={handleWsPersonPick}
        />
      )}

      {/* One-time official picker after a by-work-area drag-to-paint gesture */}
      {dragOfficialPicker && (
        <DragOfficialPicker
          dragOfficialPicker={dragOfficialPicker}
          availableOfficials={dragAvailableOfficials}
          onPick={handleDragOfficialPick}
        />
      )}

      {/* Slot modal for by-work-area expanded rows */}
      {wsSlotModal && (
        <WsSlotModal
          wsSlotModal={wsSlotModal}
          wsSlotModalSearch={wsSlotModalSearch}
          onSearchChange={setWsSlotModalSearch}
          activeAssignments={activeAssignments}
          officials={officials}
          onRemove={handleWsSlotRemove}
          onAdd={handleWsSlotAdd}
          onClose={closeWsSlotModal}
        />
      )}

      <SchedulingLegend />
    </div>
  )
}

'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ScrollShadow,
  Input,
} from '@heroui/react'
import { saveAssignments, type AssignmentInput } from '../actions'
import { getAllocableDays } from '@/lib/scheduling/allocable-range'
import {
  getCurrentStage,
  generateSlotsForDay,
  slotEndTime,
  isWithinWindow,
  formatDayLabel,
  formatSlotLabel,
  initials,
  computeOverCapacityCells,
  computeDoubleBookedOfficials,
  computeDoubleBookedDetails,
} from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { toLocalAssignments } from './grid-helpers'
import { SetupEmptyState } from './setup-empty-state'
import { SchedulingLegend } from './scheduling-legend'
import { ByPersonGrid } from './by-person-grid'
import { ByWorkAreaGrid } from './by-work-area-grid'
import type { Stage, WorkstationData, OfficialData, AssignmentData, LocalAssignment } from './scheduling-types'

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
}

type View = 'by-person' | 'by-work-area'

// ─── Component ───────────────────────────────────────────────────────────────

export function SchedulingGrid({
  tenantSlug,
  tenantId,
  granularityMin,
  stages,
  workstations,
  officials,
  initialAssignments,
}: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const [selectedStageId, setSelectedStageId] = useState<string>(
    () => getCurrentStage(stages)?.id ?? stages[0]?.id ?? ''
  )
  const [view, setView] = useState<View>('by-person')
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const stage = getCurrentStage(stages) ?? stages[0]
    if (!stage) return ''
    const days = getAllocableDays(stage)
    const today = new Date().toISOString().slice(0, 10)
    return days.includes(today) ? today : (days[0] ?? '')
  })
  const [assignments, setAssignments] = useState<LocalAssignment[]>(
    initialAssignments
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
  )
  // By-person work-area picker
  const [pickerCell, setPickerCell] = useState<{
    officialId: string
    slotStart: string
    anchorTop: number
    anchorLeft: number
  } | null>(null)

  // Action popup for existing assignment cells (remove / set status)
  const [cellActionCell, setCellActionCell] = useState<
    (LocalAssignment & { anchorTop: number; anchorLeft: number; anchorBottom: number }) | null
  >(null)

  // By-work-area expand state
  const [expandedWorkAreas, setExpandedWorkAreas] = useState<Set<string>>(new Set())

  // By-work-area person picker (top-level row)
  const [wsPickerCell, setWsPickerCell] = useState<{
    workstationId: string
    slotIndex: number
    slotStart: string
    anchorTop: number
    anchorLeft: number
  } | null>(null)

  // Cells currently mid-autosave — rendered as a skeleton so the grid doesn't
  // look unresponsive during the round-trip to the server.
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set())

  function personCellKey(officialId: string, slotStart: string): string {
    return `p:${officialId}:${slotStart}`
  }

  function wsCellKey(workstationId: string, slotIndex: number | null, slotStart: string): string {
    return `w:${workstationId}:${slotIndex}:${slotStart}`
  }

  function beginPending(key: string) {
    setPendingCells((prev) => new Set(prev).add(key))
  }

  function endPending(key: string) {
    setPendingCells((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  // By-work-area slot modal (expanded numbered slot rows)
  const [wsSlotModal, setWsSlotModal] = useState<{
    workstationId: string
    wsName: string
    slotIndex: number
    slotStart: string
    slotEnd: string
  } | null>(null)
  const [wsSlotModalSearch, setWsSlotModalSearch] = useState('')

  // By-work-area drag-to-paint (expanded numbered slot rows)
  const [wsDrag, setWsDrag] = useState<{
    workstationId: string
    wsName: string
    slotIndex: number
    startIdx: number
    currentIdx: number
  } | null>(null)
  const [dragOfficialPicker, setDragOfficialPicker] = useState<{
    workstationId: string
    slotIndex: number
    cellStarts: string[]
    anchorTop: number
    anchorLeft: number
  } | null>(null)
  const [dragSaving, setDragSaving] = useState(false)

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

  // Close popups when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerCell && !(e.target as HTMLElement).closest('[data-picker-cell]')) {
        setPickerCell(null)
      }
      if (cellActionCell && !(e.target as HTMLElement).closest('[data-cell-action]')) {
        setCellActionCell(null)
      }
      if (wsPickerCell && !(e.target as HTMLElement).closest('[data-ws-picker]')) {
        setWsPickerCell(null)
      }
      if (
        dragOfficialPicker &&
        !(e.target as HTMLElement).closest('[data-drag-official-picker]')
      ) {
        setDragOfficialPicker(null)
      }
    }
    if (pickerCell || cellActionCell || wsPickerCell || dragOfficialPicker) {
      document.addEventListener('mousedown', handleClick)
    }
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pickerCell, cellActionCell, wsPickerCell, dragOfficialPicker])

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

  // Finalize a by-work-area drag on mouseup (window-level so it can't get stuck
  // if the mouse leaves the table before releasing)
  useEffect(() => {
    if (!wsDrag) return

    function handleUp(e: PointerEvent) {
      setWsDrag((current) => {
        if (!current) return null
        const { workstationId, wsName, slotIndex, startIdx, currentIdx } = current
        const lo = Math.min(startIdx, currentIdx)
        const hi = Math.max(startIdx, currentIdx)

        if (lo === hi) {
          // No movement — treat as an ordinary click on a single slot.
          const slot = slots[lo]
          if (slot) handleWsExpandedSlotClick(workstationId, wsName, slotIndex, slot)
          return null
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
          setDragOfficialPicker({
            workstationId,
            slotIndex,
            cellStarts: validCells,
            anchorTop: e.clientY,
            anchorLeft: e.clientX,
          })
        }
        return null
      })
    }

    window.addEventListener('pointerup', handleUp)
    return () => window.removeEventListener('pointerup', handleUp)
  }, [wsDrag, slots, stageWorkstations, granularityMin, activeAssignments])

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

  function getAssignment(officialId: string, slotStart: string): LocalAssignment | undefined {
    return activeAssignments.find(
      (a) => a.official_id === officialId && a.timeslot_start === slotStart
    )
  }

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
    setAssignments((prev) => [...prev, ...toLocalAssignments(result.inserted ?? [], granularityMin)])
    router.refresh()
  }

  async function handleCellClick(
    officialId: string,
    slot: Date,
    ws?: WorkstationData,
    anchor?: HTMLElement
  ) {
    const slotStart = slot.toISOString()
    const existing = getAssignment(officialId, slotStart)

    if (existing && !ws) {
      const rect = anchor?.getBoundingClientRect()
      setCellActionCell({
        ...existing,
        anchorTop: rect ? rect.top : 0,
        anchorLeft: rect ? rect.left : 0,
        anchorBottom: rect ? rect.bottom : 0,
      })
    } else if (ws) {
      const slotEnd = slotEndTime(slot, granularityMin).toISOString()
      const slotIdx = nextLocalFreeSlot(ws.id, slotStart)
      setPickerCell(null)

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
      setPickerCell({
        officialId,
        slotStart,
        anchorTop: rect ? rect.top : 0,
        anchorLeft: rect ? rect.left : 0,
      })
    }
  }

  async function handleCellAction(action: 'remove' | 'assigned') {
    if (!cellActionCell) return
    const assignment = cellActionCell
    setCellActionCell(null)
    if (!assignment.id) return

    const key = personCellKey(assignment.official_id, assignment.timeslot_start)
    beginPending(key)
    const result =
      action === 'remove'
        ? await saveAssignments(tenantSlug, tenantId, [], [assignment.id])
        : await saveAssignments(tenantSlug, tenantId, [], [], [{ id: assignment.id, status: action }])
    endPending(key)

    if (result.error) {
      toastError(result.error)
      return
    }

    if (action === 'remove') {
      setAssignments((prev) =>
        prev.filter(
          (a) =>
            !(
              a.official_id === assignment.official_id &&
              a.timeslot_start === assignment.timeslot_start &&
              a.workstation_id === assignment.workstation_id
            )
        )
      )
    } else {
      setAssignments((prev) =>
        prev.map((a) =>
          a.official_id === assignment.official_id &&
          a.timeslot_start === assignment.timeslot_start &&
          a.workstation_id === assignment.workstation_id
            ? { ...a, status: action }
            : a
        )
      )
    }
    router.refresh()
  }

  async function handleWsPersonPick(officialId: string) {
    if (!wsPickerCell) return
    const { workstationId, slotIndex, slotStart } = wsPickerCell
    const slot = new Date(slotStart)
    const slotEnd = slotEndTime(slot, granularityMin).toISOString()
    setWsPickerCell(null)

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

  function handleWsExpandedSlotClick(wsId: string, wsName: string, slotIndex: number, slot: Date) {
    const slotEnd = slotEndTime(slot, granularityMin).toISOString()
    setWsSlotModal({
      workstationId: wsId,
      wsName,
      slotIndex,
      slotStart: slot.toISOString(),
      slotEnd,
    })
    setWsSlotModalSearch('')
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
    setWsSlotModal(null)
    setWsSlotModalSearch('')
    addAssignment(workstationId, slotIndex, slotStart, slotEnd, officialId)
  }

  // ─── Drag-to-paint (by-work-area, expanded numbered slot rows) ───────────

  function handleWsDragStart(wsId: string, wsName: string, slotIndex: number, idx: number) {
    if (dragSaving) return
    setWsDrag({ workstationId: wsId, wsName, slotIndex, startIdx: idx, currentIdx: idx })
  }

  function handleWsDragEnter(wsId: string, slotIndex: number, idx: number) {
    setWsDrag((prev) => {
      if (!prev || prev.workstationId !== wsId || prev.slotIndex !== slotIndex) return prev
      if (prev.currentIdx === idx) return prev
      return { ...prev, currentIdx: idx }
    })
  }

  // Persists a drag-to-paint batch immediately (rather than leaving it in
  // local state for the manual Save button) so a slot-collision from another
  // admin only affects this small batch, not every other pending edit on the
  // page — and so a big drag doesn't silently discard its own valid cells if
  // just one of them collides.
  async function handleDragOfficialPick(officialId: string) {
    if (!dragOfficialPicker) return
    const { workstationId, slotIndex, cellStarts } = dragOfficialPicker
    setDragOfficialPicker(null)
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

    const key = wsCellKey(assignment.workstation_id, assignment.slot_index, assignment.timeslot_start)
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
                setPickerCell(null)
                setCellActionCell(null)
                setSelectedDay(getAllocableDays(stage)[0] ?? '')
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
              onPress={() => setSelectedDay(availableDays[dayIndex - 1])}
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
              onPress={() => setSelectedDay(availableDays[dayIndex + 1])}
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
        <div className="no-print mb-3 flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-md text-sm text-gray-700">
          <svg
            className="w-4 h-4 text-gray-500 shrink-0"
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
          onToggleExpand={(wsId) =>
            setExpandedWorkAreas((prev) => {
              const next = new Set(prev)
              if (next.has(wsId)) next.delete(wsId)
              else next.add(wsId)
              return next
            })
          }
          onWsExpandedSlotClick={handleWsExpandedSlotClick}
          wsDrag={wsDrag}
          onWsDragStart={handleWsDragStart}
          onWsDragEnter={handleWsDragEnter}
          dragOfficialPicker={dragOfficialPicker}
        />
      )}

      {/* Action popup — status change / remove for an existing assignment */}
      {cellActionCell &&
        (() => {
          const ws = workstations.find((w) => w.id === cellActionCell.workstation_id)
          const status = cellActionCell.status
          return (
            <div
              className="fixed bg-white border border-gray-200 rounded-md shadow-lg z-50 min-w-[160px]"
              style={{
                top: cellActionCell.anchorBottom ?? 0,
                left: cellActionCell.anchorLeft ?? 0,
              }}
              data-cell-action
            >
              <p className="px-3 pt-2.5 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider truncate max-w-[200px]">
                {ws?.name ?? '—'}
              </p>
              <div className="border-t border-gray-100 py-1">
                <Button
                  color="danger"
                  variant="light"
                  size="sm"
                  className="w-full justify-start rounded-none px-3 hover:bg-red-50"
                  onPress={() => handleCellAction('remove')}
                >
                  {t('scheduling.actionRemove')}
                </Button>
                {status !== 'assigned' && (
                  <Button
                    variant="light"
                    size="sm"
                    className="w-full justify-start rounded-none px-3 hover:bg-gray-50"
                    onPress={() => handleCellAction('assigned')}
                  >
                    {t('scheduling.actionMarkAssigned')}
                  </Button>
                )}
              </div>
            </div>
          )
        })()}

      {/* Person picker for by-work-area expanded view */}
      {wsPickerCell &&
        (() => {
          const slot = new Date(wsPickerCell.slotStart)
          const assignedAtSlot = new Set(
            activeAssignments
              .filter((a) => a.timeslot_start === wsPickerCell.slotStart)
              .map((a) => a.official_id)
          )
          const availableOfficials = officials.filter((off) => !assignedAtSlot.has(off.id))
          return (
            <div
              className="fixed w-52 bg-white border border-gray-200 rounded-md shadow-lg z-50"
              style={{
                top: wsPickerCell.anchorTop,
                left: wsPickerCell.anchorLeft,
                transform: 'translateY(calc(-100% - 4px))',
              }}
              data-ws-picker
            >
              <p className="px-3 pt-2 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider">
                {t('scheduling.assignPerson', {
                  slot: formatSlotLabel(slot),
                  index: wsPickerCell.slotIndex,
                })}
              </p>
              {availableOfficials.length === 0 ? (
                <p className="px-3 py-2 text-sm text-gray-400">
                  {t('scheduling.noConfirmedOfficials')}
                </p>
              ) : (
                <ScrollShadow className="flex flex-col max-h-64">
                  {availableOfficials.map((off) => (
                    <Button
                      key={off.id}
                      variant="light"
                      size="sm"
                      className="w-full justify-start rounded-none px-3 hover:bg-gray-50"
                      onPress={() => handleWsPersonPick(off.id)}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-medium text-gray-600 shrink-0">
                          {initials(off.name)}
                        </span>
                        <span className="truncate">{off.name}</span>
                      </span>
                    </Button>
                  ))}
                </ScrollShadow>
              )}
            </div>
          )
        })()}

      {/* One-time official picker after a by-work-area drag-to-paint gesture */}
      {dragOfficialPicker && (
        <div
          className="fixed w-52 bg-white border border-gray-200 rounded-md shadow-lg z-50"
          style={{
            top: dragOfficialPicker.anchorTop,
            left: dragOfficialPicker.anchorLeft,
            transform: 'translateY(calc(-100% - 4px))',
          }}
          data-drag-official-picker
        >
          <p className="px-3 pt-2 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider">
            {t('scheduling.dragPaintPickPerson', { count: dragOfficialPicker.cellStarts.length })}
          </p>
          {dragAvailableOfficials.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-400">
              {t('scheduling.noConfirmedOfficials')}
            </p>
          ) : (
            <ScrollShadow className="flex flex-col max-h-64">
              {dragAvailableOfficials.map((off) => (
                <Button
                  key={off.id}
                  variant="light"
                  size="sm"
                  className="w-full justify-start rounded-none px-3 hover:bg-gray-50"
                  onPress={() => handleDragOfficialPick(off.id)}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-medium text-gray-600 shrink-0">
                      {initials(off.name)}
                    </span>
                    <span className="truncate">{off.name}</span>
                  </span>
                </Button>
              ))}
            </ScrollShadow>
          )}
        </div>
      )}

      {/* Slot modal for by-work-area expanded rows */}
      {wsSlotModal &&
        (() => {
          const slot = new Date(wsSlotModal.slotStart)
          const assignedInSlot = activeAssignments.filter(
            (a) =>
              a.workstation_id === wsSlotModal.workstationId &&
              a.timeslot_start === wsSlotModal.slotStart &&
              a.slot_index === wsSlotModal.slotIndex
          )
          const assignedAtSlot = new Set(
            activeAssignments
              .filter((a) => a.timeslot_start === wsSlotModal.slotStart)
              .map((a) => a.official_id)
          )
          const availableOfficialsAll = officials.filter((off) => !assignedAtSlot.has(off.id))
          const availableOfficials = availableOfficialsAll.filter((off) =>
            off.name.toLowerCase().includes(wsSlotModalSearch.toLowerCase())
          )
          return (
            <Modal
              isOpen
              size="2xl"
              onOpenChange={(open) => {
                if (!open) {
                  setWsSlotModal(null)
                  setWsSlotModalSearch('')
                }
              }}
            >
              <ModalContent>
                {() => (
                  <>
                    <ModalHeader className="flex flex-col gap-1 text-sm font-semibold">
                      {t('scheduling.slotModalTitle', {
                        index: wsSlotModal.slotIndex,
                        ws: wsSlotModal.wsName,
                        time: formatSlotLabel(slot),
                      })}
                    </ModalHeader>
                    <ModalBody>
                      {assignedInSlot.length === 0 && availableOfficialsAll.length === 0 && (
                        <p className="text-sm text-gray-400">{t('scheduling.slotModalEmpty')}</p>
                      )}

                      {assignedInSlot.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                            {t('scheduling.slotModalAssigned')}
                          </p>
                          {assignedInSlot.map((a) => {
                            const off = officials.find((o) => o.id === a.official_id)
                            return (
                              <div
                                key={a.official_id}
                                className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 mb-2"
                              >
                                <span className="text-sm text-gray-900">{off?.name ?? '—'}</span>
                                <Button
                                  color="danger"
                                  variant="light"
                                  size="sm"
                                  onPress={() => handleWsSlotRemove(a)}
                                >
                                  {t('scheduling.slotModalRemove')}
                                </Button>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {assignedInSlot.length === 0 && availableOfficialsAll.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                            {t('scheduling.slotModalAvailable', { time: formatSlotLabel(slot) })}
                          </p>
                          <Input
                            type="text"
                            size="sm"
                            placeholder={t('scheduling.slotModalSearchPlaceholder')}
                            value={wsSlotModalSearch}
                            onValueChange={setWsSlotModalSearch}
                            className="mb-2"
                          />
                          {availableOfficials.length === 0 ? (
                            <p className="text-sm text-gray-400 px-1 py-2">
                              {t('scheduling.slotModalNoResults')}
                            </p>
                          ) : (
                            <ScrollShadow className="flex flex-col max-h-80 divide-y divide-gray-100">
                              {availableOfficials.map((off) => (
                                <div
                                  key={off.id}
                                  className="flex items-center justify-between px-2 py-1.5"
                                >
                                  <span className="text-sm text-gray-900">{off.name}</span>
                                  <Button
                                    variant="bordered"
                                    size="sm"
                                    onPress={() => handleWsSlotAdd(off.id)}
                                  >
                                    {t('scheduling.slotModalAdd')}
                                  </Button>
                                </div>
                              ))}
                            </ScrollShadow>
                          )}
                        </div>
                      )}
                    </ModalBody>
                  </>
                )}
              </ModalContent>
            </Modal>
          )
        })()}

      <SchedulingLegend />
    </div>
  )
}

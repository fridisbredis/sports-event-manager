'use client'

import React, { useState, useMemo, useRef, useEffect } from 'react'
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
  Card,
  CardBody,
  ScrollShadow,
  Input,
  Skeleton,
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
  formatSlotDateTimeLabel,
  initials,
  shortName,
  computeOverCapacityCells,
  computeDoubleBookedOfficials,
  computeDoubleBookedDetails,
} from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Stage {
  id: string
  name: string
  stage_type: string
  stage_date: string | null
  start_time: string | null
  end_time: string | null
}

interface OperatingWindow {
  id: string
  window_start: string
  window_end: string
}

interface WorkstationData {
  id: string
  name: string
  capacity_ceiling: number
  stage_id: string | null
  workstation_operating_windows: OperatingWindow[]
}

interface OfficialData {
  id: string
  name: string
  invite_status: string
}

interface AssignmentData {
  id: string
  official_id: string
  workstation_id: string | null
  timeslot_start: string
  timeslot_end: string
  status: string
  slot_index: number | null
}

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

interface LocalAssignment {
  id: string | null
  official_id: string
  workstation_id: string
  timeslot_start: string
  timeslot_end: string
  status: string
  slot_index: number | null
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
      const result = await saveAssignments(
        tenantSlug,
        tenantId,
        [
          {
            official_id: officialId,
            workstation_id: ws.id,
            timeslot_start: slotStart,
            timeslot_end: slotEnd,
            slot_index: slotIdx,
          },
        ],
        []
      )
      endPending(key)

      if (result.error) {
        toastError(result.error)
      } else {
        setAssignments((prev) => [
          ...prev,
          ...(result.inserted ?? []).map((r) => ({
            id: r.id,
            official_id: r.official_id,
            workstation_id: r.workstation_id!,
            timeslot_start: new Date(r.timeslot_start).toISOString(),
            timeslot_end: slotEndTime(new Date(r.timeslot_start), granularityMin).toISOString(),
            status: 'assigned',
            slot_index: r.slot_index,
          })),
        ])
        router.refresh()
      }
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
    const result = await saveAssignments(
      tenantSlug,
      tenantId,
      [
        {
          official_id: officialId,
          workstation_id: workstationId,
          timeslot_start: slotStart,
          timeslot_end: slotEnd,
          slot_index: slotIndex,
        },
      ],
      []
    )
    endPending(key)

    if (result.error) {
      toastError(result.error)
    } else {
      setAssignments((prev) => [
        ...prev,
        ...(result.inserted ?? []).map((r) => ({
          id: r.id,
          official_id: r.official_id,
          workstation_id: r.workstation_id!,
          timeslot_start: new Date(r.timeslot_start).toISOString(),
          timeslot_end: slotEndTime(new Date(r.timeslot_start), granularityMin).toISOString(),
          status: 'assigned',
          slot_index: r.slot_index,
        })),
      ])
      router.refresh()
    }
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
    const result = await saveAssignments(
      tenantSlug,
      tenantId,
      [
        {
          official_id: officialId,
          workstation_id: workstationId,
          timeslot_start: slotStart,
          timeslot_end: slotEnd,
          slot_index: slotIndex,
        },
      ],
      []
    )
    endPending(key)

    if (result.error) {
      toastError(result.error)
    } else {
      setAssignments((prev) => [
        ...prev,
        ...(result.inserted ?? []).map((r) => ({
          id: r.id,
          official_id: r.official_id,
          workstation_id: r.workstation_id!,
          timeslot_start: new Date(r.timeslot_start).toISOString(),
          timeslot_end: slotEndTime(new Date(r.timeslot_start), granularityMin).toISOString(),
          status: 'assigned',
          slot_index: r.slot_index,
        })),
      ])
      router.refresh()
    }
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

    const result = await saveAssignments(tenantSlug, tenantId, additions, [])

    if (result.error) {
      toastError(result.error)
    } else {
      setAssignments((prev) => [
        ...prev,
        ...(result.inserted ?? []).map((r) => ({
          id: r.id,
          official_id: r.official_id,
          workstation_id: r.workstation_id!,
          timeslot_start: new Date(r.timeslot_start).toISOString(),
          timeslot_end: slotEndTime(new Date(r.timeslot_start), granularityMin).toISOString(),
          status: 'assigned',
          slot_index: r.slot_index,
        })),
      ])
      router.refresh()
    }

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

// ─── Setup empty state (no officials AND no work areas configured) ─────────────

function SetupEmptyState() {
  const { t } = useTranslation('admin')
  return (
    <div className="border border-gray-200 rounded-md bg-white py-16 flex flex-col items-center gap-3">
      <div className="w-16 h-16 border-2 border-gray-300 rounded-md flex items-center justify-center">
        <svg
          className="w-8 h-8 text-gray-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 20L20 4M4 4l16 16"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700">{t('scheduling.noAssignmentsTitle')}</p>
      <p className="text-sm text-gray-500 text-center max-w-xs">
        {t('scheduling.noAssignmentsHint')}
      </p>
    </div>
  )
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function SchedulingLegend() {
  const { t } = useTranslation('admin')
  return (
    <div className="no-print mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded font-mono text-gray-700">
          2/3
        </span>
        {t('scheduling.legendCapacity')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-flex items-center justify-center w-4 h-4 border border-gray-400 rounded-sm text-gray-500 text-[10px]">
          ⊗
        </span>
        {t('scheduling.legendDoubleBooked')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-8 h-4 rounded-sm bg-orange-50 border border-orange-200 inline-block" />
        {t('scheduling.legendOverCapacity')}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="w-8 h-4 rounded-sm inline-block border border-gray-200"
          style={{
            background:
              'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)',
          }}
        />
        {t('scheduling.legendOutsideWindow')}
      </span>
    </div>
  )
}

// ─── By-person grid ───────────────────────────────────────────────────────────

interface ByPersonGridProps {
  slots: Date[]
  granularityMin: number
  officials: OfficialData[]
  stageWorkstations: WorkstationData[]
  activeAssignments: LocalAssignment[]
  doubleBookedOfficials: Set<string>
  pickerCell: {
    officialId: string
    slotStart: string
    anchorTop: number
    anchorLeft: number
  } | null
  onCellClick: (officialId: string, slot: Date, ws?: WorkstationData, anchor?: HTMLElement) => void
  pendingCells: Set<string>
}

function ByPersonGrid({
  slots,
  granularityMin,
  officials,
  stageWorkstations,
  activeAssignments,
  doubleBookedOfficials,
  pickerCell,
  onCellClick,
  pendingCells,
}: ByPersonGridProps) {
  const { t } = useTranslation('admin')

  const assignmentMap = useMemo(() => {
    const map = new Map<string, LocalAssignment>()
    for (const a of activeAssignments) {
      map.set(`${a.official_id}:${a.timeslot_start}`, a)
    }
    return map
  }, [activeAssignments])

  const countMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of activeAssignments) {
      const key = `${a.workstation_id}:${a.timeslot_start}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [activeAssignments])

  const slotStartSet = useMemo(() => new Set(slots.map((s) => s.toISOString())), [slots])
  const hasAssignmentsToday = activeAssignments.some((a) => slotStartSet.has(a.timeslot_start))

  // Slots where at least one workstation is within its operating window
  const activeSlotSet = useMemo(() => {
    const set = new Set<string>()
    for (const slot of slots) {
      if (
        stageWorkstations.some((ws) =>
          isWithinWindow(slot, granularityMin, ws.workstation_operating_windows)
        )
      ) {
        set.add(slot.toISOString())
      }
    }
    return set
  }, [slots, granularityMin, stageWorkstations])

  if (officials.length === 0) {
    return (
      <div className="border border-gray-200 rounded-md bg-white py-12 text-center text-sm text-gray-500">
        {t('scheduling.noConfirmedOfficials')}
      </div>
    )
  }

  return (
    <div className="scheduling-scroll-container border border-gray-200 rounded-md bg-white overflow-x-auto overflow-y-auto max-h-[70vh] relative">
      <table className="w-full border-collapse text-sm table-fixed">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-30 bg-white text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-40 border-r border-b border-gray-100">
              {t('scheduling.colOfficial')}
            </th>
            {slots.map((slot) => (
              <th
                key={slot.toISOString()}
                className="sticky top-0 z-20 bg-white text-center px-1 py-3 text-xs font-medium text-gray-500 w-20 border-b border-gray-100"
              >
                {formatSlotLabel(slot)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {officials.map((official) => (
            <tr key={official.id} className="border-b border-gray-50 last:border-0">
              <td className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-100">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                    {initials(official.name)}
                  </div>
                  <span className="text-sm text-gray-800 truncate" title={official.name}>
                    {official.name}
                  </span>
                </div>
              </td>
              {slots.map((slot) => {
                const slotStart = slot.toISOString()
                const assignment = assignmentMap.get(`${official.id}:${slotStart}`)
                const ws = assignment
                  ? stageWorkstations.find((w) => w.id === assignment.workstation_id)
                  : undefined
                const isDoubleBooked = doubleBookedOfficials.has(`${official.id}:${slotStart}`)
                const wsCount = ws ? (countMap.get(`${ws.id}:${slotStart}`) ?? 0) : 0

                const cellStyle = assignment
                  ? isDoubleBooked
                    ? 'bg-orange-50 border border-orange-200'
                    : 'bg-gray-100 border border-gray-200'
                  : ''

                const isPending = pendingCells.has(`p:${official.id}:${slotStart}`)

                return (
                  <td key={slotStart} className="px-1 py-2 relative">
                    {isPending ? (
                      <Skeleton className="w-full h-10 rounded-md" />
                    ) : assignment ? (
                      <button
                        onClick={(e) => onCellClick(official.id, slot, undefined, e.currentTarget)}
                        className={`flex w-full h-10 flex-col items-center justify-center gap-1 rounded-md px-1 font-medium text-gray-700 transition-colors hover:brightness-95 ${cellStyle}`}
                      >
                        <span className="w-full truncate text-center text-[11px] leading-none">
                          {ws?.name ?? '—'}
                        </span>
                        <span
                          className={`shrink-0 text-[10px] leading-none tabular-nums ${isDoubleBooked ? 'text-orange-400' : 'text-gray-400'}`}
                        >
                          {ws ? `${wsCount}/${ws.capacity_ceiling}` : ''}
                          {isDoubleBooked && ' ⊗'}
                        </span>
                      </button>
                    ) : activeSlotSet.has(slotStart) ? (
                      <button
                        onClick={(e) => onCellClick(official.id, slot, undefined, e.currentTarget)}
                        className="w-full h-10 rounded-md border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-colors"
                      />
                    ) : (
                      <div
                        className="w-full h-10 rounded-md"
                        style={{
                          background:
                            'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)',
                        }}
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {!hasAssignmentsToday && (
        <div className="px-4 py-3 border-t border-gray-50 text-center text-xs text-gray-400">
          {t('scheduling.noAssignmentsToday')}
        </div>
      )}

      {/* Work-area picker */}
      {pickerCell &&
        (() => {
          const slot = new Date(pickerCell.slotStart)
          const openWorkstations = stageWorkstations.filter((ws) =>
            isWithinWindow(slot, granularityMin, ws.workstation_operating_windows)
          )
          if (openWorkstations.length === 0) return null
          return (
            <div
              className="fixed w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50"
              style={{
                top: pickerCell.anchorTop,
                left: pickerCell.anchorLeft,
                transform: 'translateY(calc(-100% - 4px))',
              }}
              data-picker-cell
            >
              <div className="px-3 pt-2 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider">
                {t('scheduling.assignTo')}
              </div>
              <ScrollShadow className="flex flex-col max-h-64">
                {openWorkstations.map((ws) => {
                  const count = countMap.get(`${ws.id}:${pickerCell.slotStart}`) ?? 0
                  return (
                    <Button
                      key={ws.id}
                      variant="light"
                      size="sm"
                      className="w-full justify-between rounded-none px-3"
                      onPress={() => onCellClick(pickerCell.officialId, slot, ws)}
                    >
                      <span className="truncate">{ws.name}</span>
                      <span className="ml-2 text-xs text-gray-400 tabular-nums shrink-0">
                        {count}/{ws.capacity_ceiling}
                      </span>
                    </Button>
                  )
                })}
              </ScrollShadow>
            </div>
          )
        })()}
    </div>
  )
}

// ─── By-work-area grid ────────────────────────────────────────────────────────

interface ByWorkAreaGridProps {
  slots: Date[]
  granularityMin: number
  officials: OfficialData[]
  stageWorkstations: WorkstationData[]
  activeAssignments: LocalAssignment[]
  overCapacityCells: Set<string>
  expandedWorkAreas: Set<string>
  onToggleExpand: (wsId: string) => void
  onWsExpandedSlotClick: (wsId: string, wsName: string, slotIndex: number, slot: Date) => void
  wsDrag: {
    workstationId: string
    slotIndex: number
    startIdx: number
    currentIdx: number
  } | null
  onWsDragStart: (wsId: string, wsName: string, slotIndex: number, idx: number) => void
  onWsDragEnter: (wsId: string, slotIndex: number, idx: number) => void
  dragOfficialPicker: {
    workstationId: string
    slotIndex: number
    cellStarts: string[]
  } | null
  pendingCells: Set<string>
}

function ByWorkAreaGrid({
  slots,
  granularityMin,
  officials,
  stageWorkstations,
  activeAssignments,
  overCapacityCells,
  expandedWorkAreas,
  onToggleExpand,
  onWsExpandedSlotClick,
  wsDrag,
  onWsDragStart,
  onWsDragEnter,
  dragOfficialPicker,
  pendingCells,
}: ByWorkAreaGridProps) {
  const { t } = useTranslation('admin')

  const countMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of activeAssignments) {
      const key = `${a.workstation_id}:${a.timeslot_start}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [activeAssignments])

  // (wsId:slotStart:slotIndex) → assignment
  const slotIndexMap = useMemo(() => {
    const map = new Map<string, LocalAssignment>()
    for (const a of activeAssignments) {
      if (a.slot_index !== null) {
        map.set(`${a.workstation_id}:${a.timeslot_start}:${a.slot_index}`, a)
      }
    }
    return map
  }, [activeAssignments])

  // Official name lookup by id
  const officialNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const o of officials) map.set(o.id, o.name)
    return map
  }, [officials])

  if (stageWorkstations.length === 0) {
    return (
      <div className="border border-gray-200 rounded-md bg-white py-12 text-center text-sm text-gray-500">
        {t('scheduling.noWorkAreas')}
      </div>
    )
  }

  const hasOutOfWindow = stageWorkstations.some((ws) => ws.workstation_operating_windows.length > 0)

  return (
    <div className="scheduling-scroll-container border border-gray-200 rounded-md bg-white overflow-x-auto overflow-y-auto max-h-[70vh]">
      {hasOutOfWindow && (
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-8 h-4 rounded-sm bg-gray-100 border border-gray-200 inline-block" />
            {t('scheduling.legendAssignable')}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-8 h-4 rounded-sm inline-block border border-gray-200"
              style={{
                background:
                  'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)',
              }}
            />
            {t('scheduling.legendOutsideWindow')}
          </span>
        </div>
      )}
      <table className="w-full border-collapse text-sm table-fixed">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-30 bg-white text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-44 border-r border-b border-gray-100">
              {t('scheduling.colWorkArea')}
            </th>
            {slots.map((slot) => (
              <th
                key={slot.toISOString()}
                className="sticky top-0 z-20 bg-white text-center px-1 py-3 text-xs font-medium text-gray-500 w-20 border-b border-gray-100"
              >
                {formatSlotLabel(slot)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stageWorkstations.map((ws) => {
            const isExpanded = expandedWorkAreas.has(ws.id)

            // Overflow assignments: slot_index > capacity_ceiling
            const overflowBySlot = new Map<string, LocalAssignment[]>()
            for (const a of activeAssignments) {
              if (a.workstation_id !== ws.id) continue
              if (a.slot_index !== null && a.slot_index > ws.capacity_ceiling) {
                const arr = overflowBySlot.get(a.timeslot_start) ?? []
                arr.push(a)
                overflowBySlot.set(a.timeslot_start, arr)
              }
            }
            const hasOverflow = overflowBySlot.size > 0

            return (
              <React.Fragment key={ws.id}>
                {/* Summary row (always visible) */}
                <tr className="border-b border-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-3 border-r border-gray-100">
                    <div className="flex items-center gap-2">
                      <Button
                        isIconOnly
                        variant="light"
                        size="sm"
                        onPress={() => onToggleExpand(ws.id)}
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        className="w-5 h-5 min-w-0 text-gray-400 shrink-0"
                      >
                        <svg
                          className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </Button>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate" title={ws.name}>
                          {ws.name}
                        </div>
                        <div className="text-xs text-gray-400">
                          {t('workstations.upTo', { n: ws.capacity_ceiling })}
                        </div>
                      </div>
                    </div>
                  </td>
                  {slots.map((slot) => {
                    const slotStart = slot.toISOString()
                    const key = `${ws.id}:${slotStart}`
                    const count = countMap.get(key) ?? 0
                    const inWindow = isWithinWindow(
                      slot,
                      granularityMin,
                      ws.workstation_operating_windows
                    )
                    const isOver = overCapacityCells.has(key)

                    if (!inWindow) {
                      return (
                        <td key={slotStart} className="px-1 py-2">
                          <div
                            className="w-full h-10 rounded-md"
                            style={{
                              background:
                                'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)',
                            }}
                          />
                        </td>
                      )
                    }
                    return (
                      <td key={slotStart} className="px-1 py-2">
                        <div
                          className={`flex w-full h-10 flex-col items-center justify-center rounded-md px-2 text-xs font-medium text-center ${
                            isOver
                              ? 'bg-orange-50 border border-orange-200 text-orange-700'
                              : count === 0
                                ? 'bg-white border border-gray-200 text-gray-400'
                                : 'bg-gray-100 border border-gray-200 text-gray-700'
                          }`}
                        >
                          {count} / {ws.capacity_ceiling}
                          {isOver && (
                            <div className="text-[10px] font-normal text-orange-500 leading-none">
                              {t('scheduling.overCapacityBadge')}
                            </div>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>

                {/* Numbered slot rows (visible when expanded) */}
                {isExpanded &&
                  Array.from({ length: ws.capacity_ceiling }, (_, i) => i + 1).map((slotIdx) => (
                    <tr
                      key={`${ws.id}-slot-${slotIdx}`}
                      className="border-b border-gray-50 bg-gray-50/40"
                    >
                      <td className="sticky left-0 z-10 bg-gray-50 pl-12 pr-3 py-1.5 border-r border-gray-100">
                        <span className="text-xs text-gray-400 font-mono">#{slotIdx}</span>
                      </td>
                      {slots.map((slot, slotArrIdx) => {
                        const slotStart = slot.toISOString()
                        const inWindow = isWithinWindow(
                          slot,
                          granularityMin,
                          ws.workstation_operating_windows
                        )
                        const assignment = slotIndexMap.get(`${ws.id}:${slotStart}:${slotIdx}`)
                        const officialName = assignment
                          ? (officialNameMap.get(assignment.official_id) ?? '—')
                          : undefined
                        const inDragRange =
                          (!!wsDrag &&
                            wsDrag.workstationId === ws.id &&
                            wsDrag.slotIndex === slotIdx &&
                            slotArrIdx >= Math.min(wsDrag.startIdx, wsDrag.currentIdx) &&
                            slotArrIdx <= Math.max(wsDrag.startIdx, wsDrag.currentIdx)) ||
                          (!!dragOfficialPicker &&
                            dragOfficialPicker.workstationId === ws.id &&
                            dragOfficialPicker.slotIndex === slotIdx &&
                            dragOfficialPicker.cellStarts.includes(slotStart))

                        if (!inWindow) {
                          return (
                            <td key={slotStart} className="px-1 py-1.5">
                              <div
                                onPointerEnter={() => onWsDragEnter(ws.id, slotIdx, slotArrIdx)}
                                className="w-full h-10 rounded-md opacity-30"
                                style={{
                                  background:
                                    'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)',
                                }}
                              />
                            </td>
                          )
                        }
                        const isPending = pendingCells.has(`w:${ws.id}:${slotIdx}:${slotStart}`)

                        return (
                          <td key={slotStart} className="px-1 py-1.5">
                            {isPending ? (
                              <Skeleton className="w-full h-10 rounded-md" />
                            ) : assignment && officialName ? (
                              <button
                                onClick={() => onWsExpandedSlotClick(ws.id, ws.name, slotIdx, slot)}
                                onPointerEnter={() => onWsDragEnter(ws.id, slotIdx, slotArrIdx)}
                                title={officialName}
                                className={`w-full h-10 rounded-md border px-2 text-center text-xs truncate transition-colors hover:brightness-95 bg-gray-100 border-gray-200 text-gray-700 ${inDragRange ? 'ring-2 ring-blue-400' : ''}`}
                              >
                                {shortName(officialName)}
                              </button>
                            ) : (
                              <button
                                onPointerDown={() => onWsDragStart(ws.id, ws.name, slotIdx, slotArrIdx)}
                                onPointerEnter={() => onWsDragEnter(ws.id, slotIdx, slotArrIdx)}
                                className={`w-full h-10 rounded-md border transition-colors ${
                                  inDragRange
                                    ? 'border-blue-300 bg-blue-50'
                                    : 'border-transparent hover:border-gray-200 hover:bg-white'
                                }`}
                              />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}

                {/* Overflow row — assignments with slot_index > capacity_ceiling */}
                {isExpanded && hasOverflow && (
                  <tr key={`${ws.id}-overflow`} className="border-b border-gray-50 bg-orange-50/20">
                    <td className="sticky left-0 z-10 bg-orange-50 pl-12 pr-3 py-1.5 border-r border-gray-100">
                      <span className="text-xs text-orange-500 font-medium">
                        {t('scheduling.overflowRow')}
                      </span>
                    </td>
                    {slots.map((slot) => {
                      const slotStart = slot.toISOString()
                      const overflows = overflowBySlot.get(slotStart) ?? []
                      return (
                        <td key={slotStart} className="px-1 py-1.5">
                          {overflows.length > 0 && (
                            <div className="w-full h-10 rounded-md bg-orange-100 border border-orange-200 flex items-center justify-center text-xs text-orange-600 font-medium">
                              +{overflows.length}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

'use client'

import React, { useState, useMemo, useRef, useEffect } from 'react'
import { saveAssignments, type AssignmentInput } from '../actions'
import { getAllocableRange, getAllocableDays } from '@/lib/scheduling/allocable-range'
import { useTranslation } from '@/lib/i18n/client'

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateSlotsForDay(stage: Stage, day: string, granularityMin: number): Date[] {
  const range = getAllocableRange(stage)
  if (!range) return []

  const dayStart = new Date(`${day}T00:00:00.000Z`)
  const dayEnd = new Date(`${day}T23:59:59.999Z`)

  const start = new Date(Math.max(new Date(range.start).getTime(), dayStart.getTime()))
  const end = new Date(Math.min(new Date(range.end).getTime(), dayEnd.getTime()))

  if (start >= end) return []

  const slots: Date[] = []
  const cur = new Date(start)
  while (cur < end) {
    slots.push(new Date(cur))
    cur.setMinutes(cur.getMinutes() + granularityMin)
  }
  return slots
}

function formatDayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  return date.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function slotEndTime(slot: Date, granularityMin: number): Date {
  const end = new Date(slot)
  end.setMinutes(end.getMinutes() + granularityMin)
  return end
}

function formatSlotLabel(slot: Date): string {
  return slot.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

function isWithinWindow(slot: Date, granMin: number, windows: OperatingWindow[]): boolean {
  if (windows.length === 0) return true
  const slotEnd = slotEndTime(slot, granMin)
  return windows.some((w) => {
    const wStart = new Date(w.window_start)
    const wEnd = new Date(w.window_end)
    return slot >= wStart && slotEnd <= wEnd
  })
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
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
  const [selectedStageId, setSelectedStageId] = useState<string>(stages[0]?.id ?? '')
  const [view, setView] = useState<View>('by-person')
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const first = stages[0]
    if (!first) return ''
    return getAllocableDays(first)[0] ?? ''
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
  const [deletions, setDeletions] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // By-person work-area picker
  const [pickerCell, setPickerCell] = useState<{
    officialId: string
    slotStart: string
    anchorTop: number
    anchorLeft: number
  } | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Action popup for existing assignment cells (remove / set status)
  const [cellActionCell, setCellActionCell] = useState<{
    assignment: LocalAssignment
    anchorBottom: number
    anchorLeft: number
  } | null>(null)
  const cellActionRef = useRef<HTMLDivElement>(null)

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
  const wsPickerRef = useRef<HTMLDivElement>(null)

  // By-work-area slot modal (expanded numbered slot rows)
  const [wsSlotModal, setWsSlotModal] = useState<{
    workstationId: string
    wsName: string
    slotIndex: number
    slotStart: string
    slotEnd: string
  } | null>(null)

  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? stages[0]

  const availableDays = useMemo(
    () => (selectedStage ? getAllocableDays(selectedStage) : []),
    [selectedStage]
  )

  const dayIndex = availableDays.indexOf(selectedDay)

  const slots = useMemo(
    () => (selectedStage && selectedDay ? generateSlotsForDay(selectedStage, selectedDay, granularityMin) : []),
    [selectedStage, selectedDay, granularityMin]
  )

  const stageWorkstations = useMemo(
    () => workstations.filter((w) => w.stage_id === selectedStageId),
    [workstations, selectedStageId]
  )

  // Original statuses for change detection
  const originalStatusMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of initialAssignments) {
      map.set(a.id, a.status ?? 'assigned')
    }
    return map
  }, [initialAssignments])

  // Close any open popup when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerCell(null)
      if (cellActionRef.current && !cellActionRef.current.contains(e.target as Node)) setCellActionCell(null)
      if (wsPickerRef.current && !wsPickerRef.current.contains(e.target as Node)) setWsPickerCell(null)
    }
    if (pickerCell || cellActionCell || wsPickerCell) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pickerCell, cellActionCell, wsPickerCell])

  // ─── Derived conflict data ────────────────────────────────────────────────

  const activeAssignments = useMemo(() => {
    const stageWsIds = new Set(stageWorkstations.map((w) => w.id))
    return assignments.filter(
      (a) => !deletions.has(a.id ?? '') && stageWsIds.has(a.workstation_id)
    )
  }, [assignments, deletions, stageWorkstations])

  const overCapacityCells = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of activeAssignments) {
      const key = `${a.workstation_id}:${a.timeslot_start}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const result = new Set<string>()
    for (const [key, count] of counts) {
      const wsId = key.split(':')[0]
      const ws = stageWorkstations.find((w) => w.id === wsId)
      if (ws && count > ws.capacity_ceiling) result.add(key)
    }
    return result
  }, [activeAssignments, stageWorkstations])

  const allNonDeletedAssignments = useMemo(
    () => assignments.filter((a) => !deletions.has(a.id ?? '')),
    [assignments, deletions]
  )

  const doubleBookedOfficials = useMemo(() => {
    const result = new Set<string>()
    const seenSlots = new Map<string, string>()
    for (const a of allNonDeletedAssignments) {
      const key = `${a.official_id}:${a.timeslot_start}`
      if (seenSlots.has(key) && seenSlots.get(key) !== a.workstation_id) {
        result.add(key)
      } else {
        seenSlots.set(key, a.workstation_id)
      }
    }
    return result
  }, [allNonDeletedAssignments])

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

  const doubleBookedDetails = useMemo(() => {
    const details: { officialName: string; time: string; workAreaNames: string[] }[] = []
    for (const key of doubleBookedOfficials) {
      const [officialId, timeslotStart] = key.split(/:(.+)/)
      const official = officials.find((o) => o.id === officialId)
      if (!official) continue
      const conflictingAssignments = allNonDeletedAssignments.filter(
        (a) => a.official_id === officialId && a.timeslot_start === timeslotStart
      )
      const workAreaNames = conflictingAssignments
        .map((a) => workstations.find((w) => w.id === a.workstation_id)?.name ?? '—')
        .filter((n, i, arr) => arr.indexOf(n) === i)
      details.push({
        officialName: official.name,
        time: formatSlotLabel(new Date(timeslotStart)),
        workAreaNames,
      })
    }
    return details
  }, [doubleBookedOfficials, allNonDeletedAssignments, officials, workstations])

  const hasPendingChanges =
    assignments.some((a) => a.id === null) ||
    deletions.size > 0 ||
    assignments.some((a) => a.id !== null && originalStatusMap.get(a.id) !== a.status)

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

  function handleCellClick(officialId: string, slot: Date, ws?: WorkstationData, anchor?: HTMLElement) {
    const slotStart = slot.toISOString()
    const existing = getAssignment(officialId, slotStart)

    if (existing && !ws) {
      const rect = anchor?.getBoundingClientRect()
      setCellActionCell({
        assignment: existing,
        anchorBottom: rect ? rect.bottom : 0,
        anchorLeft: rect ? rect.left : 0,
      })
    } else if (ws) {
      const slotEnd = slotEndTime(slot, granularityMin).toISOString()
      const slotIdx = nextLocalFreeSlot(ws.id, slotStart)
      setAssignments((prev) => [
        ...prev,
        { id: null, official_id: officialId, workstation_id: ws.id, timeslot_start: slotStart, timeslot_end: slotEnd, status: 'assigned', slot_index: slotIdx },
      ])
      setPickerCell(null)
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

  function handleCellAction(action: 'remove' | 'assigned') {
    if (!cellActionCell) return
    const { assignment } = cellActionCell

    if (action === 'remove') {
      if (assignment.id) setDeletions((prev) => new Set([...prev, assignment.id!]))
      setAssignments((prev) =>
        prev.filter(
          (a) => !(
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
    setCellActionCell(null)
  }

  function handleWsPersonPick(officialId: string) {
    if (!wsPickerCell) return
    const { workstationId, slotIndex, slotStart } = wsPickerCell
    const slot = new Date(slotStart)
    const slotEnd = slotEndTime(slot, granularityMin).toISOString()
    setAssignments((prev) => [
      ...prev,
      { id: null, official_id: officialId, workstation_id: workstationId, timeslot_start: slotStart, timeslot_end: slotEnd, status: 'assigned', slot_index: slotIndex },
    ])
    setWsPickerCell(null)
  }

  function handleWsExpandedSlotClick(wsId: string, wsName: string, slotIndex: number, slot: Date) {
    const slotEnd = slotEndTime(slot, granularityMin).toISOString()
    setWsSlotModal({ workstationId: wsId, wsName, slotIndex, slotStart: slot.toISOString(), slotEnd })
  }

  function handleWsSlotAdd(officialId: string) {
    if (!wsSlotModal) return
    const { workstationId, slotIndex, slotStart, slotEnd } = wsSlotModal
    setAssignments((prev) => [
      ...prev,
      { id: null, official_id: officialId, workstation_id: workstationId, timeslot_start: slotStart, timeslot_end: slotEnd, status: 'assigned', slot_index: slotIndex },
    ])
  }

  function handleWsSlotRemove(assignment: LocalAssignment) {
    if (assignment.id) setDeletions((prev) => new Set([...prev, assignment.id!]))
    setAssignments((prev) =>
      prev.filter((a) => !(
        a.official_id === assignment.official_id &&
        a.workstation_id === assignment.workstation_id &&
        a.timeslot_start === assignment.timeslot_start &&
        a.slot_index === assignment.slot_index
      ))
    )
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    const additions: AssignmentInput[] = assignments
      .filter((a) => a.id === null)
      .map((a) => ({
        official_id: a.official_id,
        workstation_id: a.workstation_id,
        timeslot_start: a.timeslot_start,
        timeslot_end: a.timeslot_end,
        slot_index: a.slot_index ?? undefined,
      }))

    const statusUpdateList = assignments
      .filter((a) => a.id !== null && originalStatusMap.get(a.id) !== a.status)
      .map((a) => ({ id: a.id!, status: a.status }))

    const result = await saveAssignments(tenantSlug, tenantId, additions, [...deletions], statusUpdateList)

    if (result.error) {
      setSaveError(result.error)
    } else {
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      setAssignments((prev) =>
        prev
          .filter((a) => !deletions.has(a.id ?? ''))
          .map((a) => {
            if (a.id !== null) return a
            const match = result.inserted?.find(
              (r) =>
                r.official_id === a.official_id &&
                r.workstation_id === a.workstation_id &&
                new Date(r.timeslot_start).getTime() === new Date(a.timeslot_start).getTime()
            )
            return match ? { ...a, id: match.id, slot_index: match.slot_index ?? a.slot_index } : a
          })
      )
      setDeletions(new Set())
    }
    setSaving(false)
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
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t('scheduling.title')}</h1>

        {/* Stage selector */}
        <div className="relative">
          <button
            onClick={() => setStageDropdownOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            {selectedStage?.name ?? t('scheduling.selectStage')}
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {stageDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-md shadow-lg z-20">
              {stages.map((stage) => (
                <button
                  key={stage.id}
                  onClick={() => {
                    setSelectedStageId(stage.id)
                    setStageDropdownOpen(false)
                    setPickerCell(null)
                    setCellActionCell(null)
                    setSelectedDay(getAllocableDays(stage)[0] ?? '')
                  }}
                  className={`flex items-center justify-between w-full px-4 py-2.5 text-sm text-left hover:bg-gray-50 ${
                    stage.id === selectedStageId ? 'font-medium text-gray-900' : 'text-gray-700'
                  }`}
                >
                  {stage.name}
                  {stage.id === selectedStageId && (
                    <svg className="w-4 h-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {availableDays.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedDay(availableDays[dayIndex - 1])}
              disabled={dayIndex <= 0}
              className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t('scheduling.prevDay')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm text-gray-600 border border-gray-200 rounded-md px-3 py-1.5 bg-white min-w-[200px] text-center capitalize">
              {selectedDay ? formatDayLabel(selectedDay) : ''}
            </span>
            <button
              onClick={() => setSelectedDay(availableDays[dayIndex + 1])}
              disabled={dayIndex >= availableDays.length - 1}
              className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t('scheduling.nextDay')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !hasPendingChanges || doubleBookedCount > 0}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            hasPendingChanges && doubleBookedCount === 0
              ? 'bg-gray-900 text-white hover:bg-gray-700'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {saving ? t('scheduling.saving') : saveSuccess ? t('scheduling.saved') : t('scheduling.save')}
        </button>
      </div>

      {saveError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {saveError}
        </div>
      )}

      {/* Conflict banners */}
      {overCapacityCount > 0 && (
        <div className="mb-3 flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-md text-sm text-gray-700">
          <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z" />
          </svg>
          {t('scheduling.overCapacity', { count: overCapacityCount })}
        </div>
      )}
      {doubleBookedCount > 0 && (
        <div className="mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
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
      <div className="flex gap-1 mb-5">
        <button
          onClick={() => setView('by-person')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'by-person'
              ? 'bg-gray-900 text-white'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('scheduling.viewByPerson')}
        </button>
        <button
          onClick={() => setView('by-work-area')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'by-work-area'
              ? 'bg-gray-900 text-white'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('scheduling.viewByWorkArea')}
        </button>
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
          pickerRef={pickerRef}
          onCellClick={handleCellClick}
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
          onToggleExpand={(wsId) =>
            setExpandedWorkAreas((prev) => {
              const next = new Set(prev)
              if (next.has(wsId)) next.delete(wsId)
              else next.add(wsId)
              return next
            })
          }
          onWsExpandedSlotClick={handleWsExpandedSlotClick}
        />
      )}

      {/* Action popup — status change / remove for an existing assignment */}
      {cellActionCell && (() => {
        const ws = workstations.find((w) => w.id === cellActionCell.assignment.workstation_id)
        const status = cellActionCell.assignment.status
        return (
          <div
            ref={cellActionRef}
            className="fixed bg-white border border-gray-200 rounded-md shadow-lg z-50 min-w-[160px]"
            style={{ top: cellActionCell.anchorBottom + 4, left: cellActionCell.anchorLeft }}
          >
            <p className="px-3 pt-2.5 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider truncate max-w-[200px]">
              {ws?.name ?? '—'}
            </p>
            <div className="border-t border-gray-100 py-1">
              <button onClick={() => handleCellAction('remove')} className="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 text-left">
                {t('scheduling.actionRemove')}
              </button>
              {status !== 'assigned' && (
                <button onClick={() => handleCellAction('assigned')} className="w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left">
                  {t('scheduling.actionMarkAssigned')}
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {/* Person picker for by-work-area expanded view */}
      {wsPickerCell && (() => {
        const slot = new Date(wsPickerCell.slotStart)
        const assignedAtSlot = new Set(
          activeAssignments.filter((a) => a.timeslot_start === wsPickerCell.slotStart).map((a) => a.official_id)
        )
        const availableOfficials = officials.filter((off) => !assignedAtSlot.has(off.id))
        return (
          <div
            ref={wsPickerRef}
            className="fixed w-52 bg-white border border-gray-200 rounded-md shadow-lg z-50"
            style={{ top: wsPickerCell.anchorTop, left: wsPickerCell.anchorLeft, transform: 'translateY(calc(-100% - 4px))' }}
          >
            <p className="px-3 pt-2 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider">
              {t('scheduling.assignPerson', { slot: formatSlotLabel(slot), index: wsPickerCell.slotIndex })}
            </p>
            {availableOfficials.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-400">{t('scheduling.noConfirmedOfficials')}</p>
            ) : (
              availableOfficials.map((off) => (
                <button
                  key={off.id}
                  onClick={() => handleWsPersonPick(off.id)}
                  className="flex items-center justify-between w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-medium text-gray-600 shrink-0">
                      {initials(off.name)}
                    </span>
                    <span className="truncate">{off.name}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        )
      })()}

      {/* Slot modal for by-work-area expanded rows */}
      {wsSlotModal && (() => {
        const slot = new Date(wsSlotModal.slotStart)
        const assignedInSlot = activeAssignments.filter(
          (a) => a.workstation_id === wsSlotModal.workstationId &&
                  a.timeslot_start === wsSlotModal.slotStart &&
                  a.slot_index === wsSlotModal.slotIndex
        )
        const assignedAtSlot = new Set(
          activeAssignments.filter((a) => a.timeslot_start === wsSlotModal.slotStart).map((a) => a.official_id)
        )
        const availableOfficials = officials.filter((off) => !assignedAtSlot.has(off.id))
        return (
          <>
            <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setWsSlotModal(null)} />
            <div className="fixed z-50 bg-white rounded-xl shadow-2xl border border-gray-200 w-80 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="px-5 pt-5 pb-3">
                <h3 className="text-sm font-semibold text-gray-900">
                  {t('scheduling.slotModalTitle', { index: wsSlotModal.slotIndex, ws: wsSlotModal.wsName, time: formatSlotLabel(slot) })}
                </h3>
              </div>

              {assignedInSlot.length === 0 && availableOfficials.length === 0 && (
                <p className="px-5 pb-5 text-sm text-gray-400">{t('scheduling.slotModalEmpty')}</p>
              )}

              {assignedInSlot.length > 0 && (
                <div className="px-5 pb-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t('scheduling.slotModalAssigned')}</p>
                  {assignedInSlot.map((a) => {
                    const off = officials.find((o) => o.id === a.official_id)
                    return (
                      <div key={a.official_id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 mb-2">
                        <span className="text-sm text-gray-900">{off?.name ?? '—'}</span>
                        <button
                          onClick={() => handleWsSlotRemove(a)}
                          className="text-xs text-gray-500 hover:text-red-600 border border-gray-200 rounded px-2 py-0.5 transition-colors"
                        >
                          {t('scheduling.slotModalRemove')}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {availableOfficials.length > 0 && (
                <div className="px-5 pb-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    {t('scheduling.slotModalAvailable', { time: formatSlotLabel(slot) })}
                  </p>
                  <div className="max-h-56 overflow-y-auto -mr-1 pr-1">
                    {availableOfficials.map((off) => (
                      <div key={off.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 mb-2">
                        <span className="text-sm text-gray-900">{off.name}</span>
                        <button
                          onClick={() => handleWsSlotAdd(off.id)}
                          className="text-xs text-gray-700 border border-gray-200 rounded px-2 py-0.5 hover:bg-gray-50 transition-colors"
                        >
                          {t('scheduling.slotModalAdd')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
                <button
                  onClick={() => setWsSlotModal(null)}
                  className="px-4 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
                >
                  {t('scheduling.slotModalCancel')}
                </button>
                <button
                  onClick={() => setWsSlotModal(null)}
                  className="px-4 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-700 transition-colors"
                >
                  {t('scheduling.slotModalDone')}
                </button>
              </div>
            </div>
          </>
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
        <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 20L20 4M4 4l16 16" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700">{t('scheduling.noAssignmentsTitle')}</p>
      <p className="text-sm text-gray-500 text-center max-w-xs">{t('scheduling.noAssignmentsHint')}</p>
    </div>
  )
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function SchedulingLegend() {
  const { t } = useTranslation('admin')
  return (
    <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded font-mono text-gray-700">2/3</span>
        {t('scheduling.legendCapacity')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-flex items-center justify-center w-4 h-4 border border-gray-400 rounded-sm text-gray-500 text-[10px]">⊗</span>
        {t('scheduling.legendDoubleBooked')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-8 h-4 rounded-sm bg-orange-50 border border-orange-200 inline-block" />
        {t('scheduling.legendOverCapacity')}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="w-8 h-4 rounded-sm inline-block border border-gray-200"
          style={{ background: 'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)' }}
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
  pickerCell: { officialId: string; slotStart: string; anchorTop: number; anchorLeft: number } | null
  pickerRef: React.RefObject<HTMLDivElement | null>
  onCellClick: (officialId: string, slot: Date, ws?: WorkstationData, anchor?: HTMLElement) => void
}

function ByPersonGrid({
  slots,
  granularityMin,
  officials,
  stageWorkstations,
  activeAssignments,
  doubleBookedOfficials,
  pickerCell,
  pickerRef,
  onCellClick,
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
      if (stageWorkstations.some((ws) => isWithinWindow(slot, granularityMin, ws.workstation_operating_windows))) {
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
    <div className="border border-gray-200 rounded-md bg-white overflow-x-auto relative">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-40 min-w-40">
              {t('scheduling.colOfficial')}
            </th>
            {slots.map((slot) => (
              <th key={slot.toISOString()} className="text-center px-1 py-3 text-xs font-medium text-gray-500 min-w-[80px]">
                {formatSlotLabel(slot)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {officials.map((official) => (
            <tr key={official.id} className="border-b border-gray-50 last:border-0">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                    {initials(official.name)}
                  </div>
                  <span className="text-sm text-gray-800">{official.name}</span>
                </div>
              </td>
              {slots.map((slot) => {
                const slotStart = slot.toISOString()
                const assignment = assignmentMap.get(`${official.id}:${slotStart}`)
                const ws = assignment ? stageWorkstations.find((w) => w.id === assignment.workstation_id) : undefined
                const isDoubleBooked = doubleBookedOfficials.has(`${official.id}:${slotStart}`)
                const wsCount = ws ? (countMap.get(`${ws.id}:${slotStart}`) ?? 0) : 0


                const cellStyle = assignment
                  ? isDoubleBooked
                    ? 'bg-orange-50 border border-orange-200'
                    : 'bg-gray-100 border border-gray-200'
                  : ''

                return (
                  <td key={slotStart} className="px-1 py-2 relative">
                    {assignment ? (
                      <button
                        onClick={(e) => onCellClick(official.id, slot, undefined, e.currentTarget)}
                        className={`w-full rounded-md px-2 py-1.5 text-xs font-medium text-gray-700 text-left transition-colors hover:brightness-95 ${cellStyle}`}
                      >
                        <span className="flex items-center justify-between gap-1">
                          <span className="truncate">{ws?.name ?? '—'}</span>
                          <span className={`shrink-0 tabular-nums ${isDoubleBooked ? 'text-orange-400' : 'text-gray-400'}`}>
                            {ws ? `${wsCount}/${ws.capacity_ceiling}` : ''}
                            {isDoubleBooked && ' ⊗'}
                          </span>
                        </span>
                      </button>
                    ) : activeSlotSet.has(slotStart) ? (
                      <button
                        onClick={(e) => onCellClick(official.id, slot, undefined, e.currentTarget)}
                        className="w-full h-8 rounded-md border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-colors"
                      />
                    ) : (
                      <div
                        className="w-full h-8 rounded-md"
                        style={{ background: 'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)' }}
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

      {/* Work-area picker — fixed so overflow-x-auto doesn't clip it */}
      {pickerCell && (() => {
        const slot = new Date(pickerCell.slotStart)
        const openWorkstations = stageWorkstations.filter((ws) =>
          isWithinWindow(slot, granularityMin, ws.workstation_operating_windows)
        )
        if (openWorkstations.length === 0) return null
        return (
          <div
            ref={pickerRef}
            className="fixed w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50"
            style={{ top: pickerCell.anchorTop, left: pickerCell.anchorLeft, transform: 'translateY(calc(-100% - 4px))' }}
          >
            <p className="px-3 pt-2 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider">
              {t('scheduling.assignTo')}
            </p>
            {openWorkstations.map((ws) => {
              const count = countMap.get(`${ws.id}:${pickerCell.slotStart}`) ?? 0
              return (
                <button
                  key={ws.id}
                  onClick={() => onCellClick(pickerCell.officialId, slot, ws)}
                  className="flex items-center justify-between w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <span className="truncate">{ws.name}</span>
                  <span className="ml-2 text-xs text-gray-400 tabular-nums shrink-0">{count}/{ws.capacity_ceiling}</span>
                </button>
              )
            })}
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
    <div className="border border-gray-200 rounded-md bg-white overflow-x-auto">
      {hasOutOfWindow && (
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-8 h-4 rounded-sm bg-gray-100 border border-gray-200 inline-block" />
            {t('scheduling.legendAssignable')}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-8 h-4 rounded-sm inline-block border border-gray-200"
              style={{ background: 'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)' }}
            />
            {t('scheduling.legendOutsideWindow')}
          </span>
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-44 min-w-44">
              {t('scheduling.colWorkArea')}
            </th>
            {slots.map((slot) => (
              <th key={slot.toISOString()} className="text-center px-1 py-3 text-xs font-medium text-gray-500 min-w-[80px]">
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
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onToggleExpand(ws.id)}
                        className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        <svg
                          className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      <div>
                        <div className="text-sm font-medium text-gray-800">{ws.name}</div>
                        <div className="text-xs text-gray-400">{t('workstations.upTo', { n: ws.capacity_ceiling })}</div>
                      </div>
                    </div>
                  </td>
                  {slots.map((slot) => {
                    const slotStart = slot.toISOString()
                    const key = `${ws.id}:${slotStart}`
                    const count = countMap.get(key) ?? 0
                    const inWindow = isWithinWindow(slot, granularityMin, ws.workstation_operating_windows)
                    const isOver = overCapacityCells.has(key)

                    if (!inWindow) {
                      return (
                        <td key={slotStart} className="px-1 py-2">
                          <div
                            className="w-full h-10 rounded-md"
                            style={{ background: 'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)' }}
                          />
                        </td>
                      )
                    }
                    return (
                      <td key={slotStart} className="px-1 py-2">
                        <div className={`w-full rounded-md px-2 py-1.5 text-xs font-medium text-center ${
                          isOver
                            ? 'bg-orange-50 border border-orange-200 text-orange-700'
                            : count === 0
                            ? 'bg-white border border-gray-200 text-gray-400'
                            : 'bg-gray-100 border border-gray-200 text-gray-700'
                        }`}>
                          {count}/{ws.capacity_ceiling}
                          {isOver && (
                            <div className="text-[10px] font-normal text-orange-500 leading-none mt-0.5">
                              {t('scheduling.overCapacityBadge')}
                            </div>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>

                {/* Numbered slot rows (visible when expanded) */}
                {isExpanded && Array.from({ length: ws.capacity_ceiling }, (_, i) => i + 1).map((slotIdx) => (
                  <tr key={`${ws.id}-slot-${slotIdx}`} className="border-b border-gray-50 bg-gray-50/40">
                    <td className="pl-12 pr-3 py-1.5">
                      <span className="text-xs text-gray-400 font-mono">#{slotIdx}</span>
                    </td>
                    {slots.map((slot) => {
                      const slotStart = slot.toISOString()
                      const inWindow = isWithinWindow(slot, granularityMin, ws.workstation_operating_windows)
                      const assignment = slotIndexMap.get(`${ws.id}:${slotStart}:${slotIdx}`)
                      const officialName = assignment ? (officialNameMap.get(assignment.official_id) ?? '—') : undefined

                      if (!inWindow) {
                        return (
                          <td key={slotStart} className="px-1 py-1.5">
                            <div
                              className="w-full h-8 rounded-sm opacity-30"
                              style={{ background: 'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)' }}
                            />
                          </td>
                        )
                      }
                      return (
                        <td key={slotStart} className="px-1 py-1.5">
                          {assignment && officialName ? (
                            <button
                              onClick={() => onWsExpandedSlotClick(ws.id, ws.name, slotIdx, slot)}
                              className="w-full h-8 rounded-sm border px-2 text-left text-xs truncate transition-colors hover:brightness-95 bg-white border-gray-200 text-gray-700"
                            >
                              {officialName}
                            </button>
                          ) : (
                            <button
                              onClick={() => onWsExpandedSlotClick(ws.id, ws.name, slotIdx, slot)}
                              className="w-full h-8 rounded-sm border border-transparent hover:border-gray-200 hover:bg-white transition-colors"
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
                    <td className="pl-12 pr-3 py-1.5">
                      <span className="text-xs text-orange-500 font-medium">{t('scheduling.overflowRow')}</span>
                    </td>
                    {slots.map((slot) => {
                      const slotStart = slot.toISOString()
                      const overflows = overflowBySlot.get(slotStart) ?? []
                      return (
                        <td key={slotStart} className="px-1 py-1.5">
                          {overflows.length > 0 && (
                            <div className="w-full h-8 rounded-sm bg-orange-100 border border-orange-200 flex items-center justify-center text-xs text-orange-600 font-medium">
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

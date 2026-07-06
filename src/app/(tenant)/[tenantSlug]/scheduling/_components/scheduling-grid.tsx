'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
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

// A local assignment key: `officialId:workstationId:slotStart`
type CellKey = string

interface LocalAssignment {
  id: string | null // null = pending addition, string = existing DB id
  official_id: string
  workstation_id: string
  timeslot_start: string
  timeslot_end: string
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
      }))
  )
  const [deletions, setDeletions] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Work-area cell click: which cell to show the work-area picker for
  const [pickerCell, setPickerCell] = useState<{
    officialId: string
    slotStart: string
    anchorTop: number
    anchorLeft: number
  } | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

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

  // Close picker when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerCell(null)
      }
    }
    if (pickerCell) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pickerCell])

  // ─── Derived conflict data ────────────────────────────────────────────────

  // Only consider active assignments (not pending deletion) for the selected stage
  const activeAssignments = useMemo(() => {
    const stageWsIds = new Set(stageWorkstations.map((w) => w.id))
    return assignments.filter(
      (a) => !deletions.has(a.id ?? '') && stageWsIds.has(a.workstation_id)
    )
  }, [assignments, deletions, stageWorkstations])

  // Over-capacity: for each (workstation, slot), count > ceiling
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

  // Double-booked: official assigned to 2+ work areas in the same slot
  const doubleBookedOfficials = useMemo(() => {
    const result = new Set<string>() // `officialId:slotStart`
    const seenSlots = new Map<string, string>() // `officialId:slotStart` → workstationId
    for (const a of activeAssignments) {
      const key = `${a.official_id}:${a.timeslot_start}`
      if (seenSlots.has(key) && seenSlots.get(key) !== a.workstation_id) {
        result.add(key)
      } else {
        seenSlots.set(key, a.workstation_id)
      }
    }
    return result
  }, [activeAssignments])

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

  const hasConflicts = overCapacityCount > 0 || doubleBookedCount > 0
  const hasPendingChanges = assignments.some((a) => a.id === null) || deletions.size > 0

  // ─── Handlers ────────────────────────────────────────────────────────────

  function getAssignment(officialId: string, slotStart: string): LocalAssignment | undefined {
    return activeAssignments.find(
      (a) => a.official_id === officialId && a.timeslot_start === slotStart
    )
  }

  function handleCellClick(officialId: string, slot: Date, ws?: WorkstationData, anchor?: HTMLElement) {
    const slotStart = slot.toISOString()
    const existing = getAssignment(officialId, slotStart)

    if (existing) {
      // Remove
      if (existing.id) {
        setDeletions((prev) => new Set([...prev, existing.id!]))
      }
      setAssignments((prev) =>
        prev.filter(
          (a) => !(a.official_id === officialId && a.timeslot_start === slotStart)
        )
      )
      setPickerCell(null)
    } else if (ws) {
      // Direct assign to specific work area (from picker)
      const slotEnd = slotEndTime(slot, granularityMin).toISOString()
      setAssignments((prev) => [
        ...prev,
        { id: null, official_id: officialId, workstation_id: ws.id, timeslot_start: slotStart, timeslot_end: slotEnd },
      ])
      setPickerCell(null)
    } else {
      // Open picker — use the anchor element's position for fixed placement
      const rect = anchor?.getBoundingClientRect()
      setPickerCell({
        officialId,
        slotStart,
        anchorTop: rect ? rect.top : 0,
        anchorLeft: rect ? rect.left : 0,
      })
    }
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
      }))

    const result = await saveAssignments(tenantSlug, tenantId, additions, [...deletions])

    if (result.error) {
      setSaveError(result.error)
    } else {
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      // Replace id:null assignments with real IDs returned from insert
      setAssignments((prev) =>
        prev
          .filter((a) => !deletions.has(a.id ?? ''))
          .map((a) => {
            if (a.id !== null) return a
            const match = result.inserted?.find(
              (r) =>
                r.official_id === a.official_id &&
                r.workstation_id === a.workstation_id &&
                r.timeslot_start === a.timeslot_start
            )
            return match ? { ...a, id: match.id } : a
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
          disabled={saving || !hasPendingChanges}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            hasPendingChanges
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
        <div className="mb-3 flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-md text-sm text-gray-700">
          <svg className="w-4 h-4 text-gray-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" strokeWidth={2} />
            <path strokeLinecap="round" strokeWidth={2} d="M8 8l8 8M16 8l-8 8" />
          </svg>
          {t('scheduling.doubleBooked', { count: doubleBookedCount })}
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

      {/* Empty state */}
      {officials.length === 0 && stageWorkstations.length === 0 ? (
        <EmptyState />
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
          stageWorkstations={stageWorkstations}
          activeAssignments={activeAssignments}
          overCapacityCells={overCapacityCells}
        />
      )}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  const { t } = useTranslation('admin')
  return (
    <div className="border border-gray-200 rounded-md bg-white py-16 flex flex-col items-center gap-3">
      <div className="w-16 h-16 border-2 border-gray-300 rounded-md flex items-center justify-center">
        <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 20L20 4M4 4l16 16" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700">{t('scheduling.noAssignmentsTitle')}</p>
      <p className="text-sm text-gray-500 text-center max-w-xs">
        {t('scheduling.noAssignmentsHint')}
      </p>
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

  if (officials.length === 0) {
    return (
      <div className="border border-gray-200 rounded-md bg-white py-12 text-center text-sm text-gray-500">
        {t('scheduling.noConfirmedOfficials')}
      </div>
    )
  }

  const hasDoubleBooked = doubleBookedOfficials.size > 0

  return (
    <div className="border border-gray-200 rounded-md bg-white overflow-x-auto relative">
      {hasDoubleBooked && (
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-4 h-4 border border-gray-400 rounded-sm text-gray-500 text-[10px]">⊗</span>
            {t('scheduling.legendDoubleBooked')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-8 h-4 rounded-sm bg-gray-100 border border-gray-200 inline-block" />
            {t('scheduling.legendNormalAssignment')}
          </span>
        </div>
      )}
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
                const ws = assignment
                  ? stageWorkstations.find((w) => w.id === assignment.workstation_id)
                  : undefined
                const isDoubleBooked = doubleBookedOfficials.has(`${official.id}:${slotStart}`)

                const wsCount = ws ? (countMap.get(`${ws.id}:${slotStart}`) ?? 0) : 0

                return (
                  <td key={slotStart} className="px-1 py-2 relative">
                    {assignment ? (
                      <button
                        onClick={() => onCellClick(official.id, slot)}
                        title={t('scheduling.removeAssignment')}
                        className={`w-full rounded-md px-2 py-1.5 text-xs font-medium text-gray-700 text-left transition-colors hover:bg-red-50 hover:text-red-700 group ${
                          isDoubleBooked
                            ? 'bg-orange-50 border border-orange-200 text-orange-700'
                            : 'bg-gray-100 border border-gray-200'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-1">
                          <span className="truncate">{ws?.name ?? '—'}</span>
                          <span className={`shrink-0 tabular-nums ${isDoubleBooked ? 'text-orange-400' : 'text-gray-400'}`}>
                            {ws ? `${wsCount}/${ws.capacity_ceiling}` : ''}
                            {isDoubleBooked && ' ⊗'}
                          </span>
                        </span>
                      </button>
                    ) : (
                      <button
                        onClick={(e) => onCellClick(official.id, slot, undefined, e.currentTarget)}
                        className="w-full h-8 rounded-md border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-colors"
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

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
            style={{
              top: pickerCell.anchorTop,
              left: pickerCell.anchorLeft,
              transform: 'translateY(calc(-100% - 4px))',
            }}
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
  stageWorkstations: WorkstationData[]
  activeAssignments: LocalAssignment[]
  overCapacityCells: Set<string>
}

function ByWorkAreaGrid({
  slots,
  granularityMin,
  stageWorkstations,
  activeAssignments,
  overCapacityCells,
}: ByWorkAreaGridProps) {
  const { t } = useTranslation('admin')

  // Count assigned officials per (workstation, slot)
  const countMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of activeAssignments) {
      const key = `${a.workstation_id}:${a.timeslot_start}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [activeAssignments])

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
            <span className="w-8 h-4 rounded-sm bg-[repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb_3px,transparent_3px,transparent_8px)] inline-block border border-gray-200" />
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
          {stageWorkstations.map((ws) => (
            <tr key={ws.id} className="border-b border-gray-50 last:border-0">
              <td className="px-4 py-3">
                <div className="text-sm font-medium text-gray-800">{ws.name}</div>
                <div className="text-xs text-gray-400">{t('workstations.upTo', { n: ws.capacity_ceiling })}</div>
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
                      className={`w-full rounded-md px-2 py-1.5 text-xs font-medium text-center ${
                        isOver
                          ? 'bg-orange-50 border border-orange-200 text-orange-700'
                          : count === 0
                          ? 'bg-white border border-gray-200 text-gray-400'
                          : 'bg-gray-100 border border-gray-200 text-gray-700'
                      }`}
                    >
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
          ))}
        </tbody>
      </table>
    </div>
  )
}

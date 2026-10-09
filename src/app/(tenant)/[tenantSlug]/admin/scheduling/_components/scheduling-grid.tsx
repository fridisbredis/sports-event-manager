'use client'

import { Clock, Layers } from 'lucide-react'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getAllocableDays } from '@/lib/scheduling/allocable-range'
import {
  generateSlotsForDay,
  slotEndTime,
  isWithinWindow,
  computeOverCapacityCells,
  computeOverCapacityDetails,
  computeDoubleBookedOfficials,
  computeDoubleBookedDetails,
  uniqueIdsFromCellKeys,
  formatSlotLabel,
} from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import { getAssignmentsForCell, buildPickerCandidates } from './grid-helpers'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { SetupEmptyState } from './setup-empty-state'
import { SchedulingWarningLegend } from './scheduling-legend'
import { SchedulingPrintStyles, SchedulingPrintHeader } from './scheduling-print-chrome'
import { SchedulingToolbar } from './scheduling-toolbar'
import { ConflictBanners } from './conflict-banners'
import { PersonDragPicker } from './person-drag-picker'
import { TimeOffPopup, type TimeOffCell } from './time-off-popup'
import { setUnavailability, clearUnavailability } from '../unavailability-actions'
import { toastError } from '@/lib/toast'
import {
  buildUnavailableSlotKeys,
  buildUnavailableSlotMap,
  findUnavailableAssignments,
  type UnavailabilityPeriod,
} from '@/lib/scheduling/unavailability'
import { SchedulingViewToggle } from './scheduling-view-toggle'
import { ByPersonGrid } from './by-person-grid'
import { ByWorkAreaGrid } from './by-work-area-grid'
import { useSchedulingGridInteraction } from './use-scheduling-grid-interaction'
import { useSchedulingAutosave } from './use-scheduling-autosave'
import { CellActionPopup } from './cell-action-popup'
import { WsSlotModal } from './ws-slot-modal'
import type {
  Stage,
  WorkstationData,
  OfficialData,
  AssignmentData,
  LocalAssignment,
  PickerCandidate,
  SchedulingView,
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
  /** Absences overlapping the day on screen. Blocking: the save action
   *  refuses an assignment that lands on one. */
  unavailability: UnavailabilityPeriod[]
  initialSelectedDay: string
  initialSelectedStageId: string
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
  unavailability,
  initialSelectedDay,
  initialSelectedStageId,
}: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  // The server already resolved the right stage (honoring a `?stage=` param
  // if one named a real stage of this event, falling back to
  // getCurrentStage/first otherwise) — trust that instead of re-deriving it
  // here, so a "review this warning" link actually lands on the flagged stage.
  const [selectedStageId, setSelectedStageId] = useState<string>(initialSelectedStageId)
  const [view, setView] = useState<SchedulingView>('by-person')
  const [selectedDay, setSelectedDay] = useState<string>(initialSelectedDay)

  // The assignments the server sent are scoped to `initialSelectedDay` — when the
  // user picks a different day, push it into the URL so the server re-fetches
  // that day's assignments instead of the client trying to slice a broader set
  // it never received. `stage` is always carried along too: page.tsx falls
  // back to getCurrentStage()/stages[0] whenever `?stage=` is absent, and for
  // an event whose dates have already passed, getCurrentStage() never matches
  // anything — so a `day`-only URL silently reverts to the wrong stage (and,
  // via its allocable days, the wrong day too) on any full reload.
  function changeDay(day: string, stageId: string = selectedStageId) {
    setSelectedDay(day)
    router.push(`?stage=${stageId}&day=${day}`, { scroll: false })
  }

  function handleSelectStage(id: string) {
    const stage = stages.find((s) => s.id === id)
    if (!stage) return
    setSelectedStageId(id)
    closePickerCell()
    closeCellActionCell()
    changeDay(getAllocableDays(stage)[0] ?? '', id)
  }

  const {
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
    dragPickerSearch,
    setDragPickerSearch,
    dragSaving,
    setDragSaving,
  } = useSchedulingGridInteraction()

  const autosave = useSchedulingAutosave({
    tenantSlug,
    tenantId,
    granularityMin,
    initialAssignments,
    beginPending,
    endPending,
  })
  const { assignments } = autosave
  const addAssignment = autosave.addAssignment
  const handleWsSlotRemove = autosave.handleWsSlotRemove

  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? stages[0]

  const availableDays = useMemo(
    () => (selectedStage ? getAllocableDays(selectedStage) : []),
    [selectedStage]
  )

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

  // Cells covered by a declared absence, as `officialId:slotStartISO` keys —
  // the same shape as doubleBookedOfficials, so the grid's per-cell lookup
  // stays one `.has()` rather than a scan over periods.
  const unavailableSlots = useMemo(
    () => buildUnavailableSlotKeys(unavailability, slots, granularityMin),
    [unavailability, slots, granularityMin]
  )

  // Same pass, but keeping the periods themselves — the grid needs to know
  // WHO recorded an absence to pick its hatch and its tooltip, not just that
  // one exists.
  const periodsByCell = useMemo(
    () => buildUnavailableSlotMap(unavailability, slots, granularityMin),
    [unavailability, slots, granularityMin]
  )

  // Assignments an admin has made over someone's declared absence. This WARNS
  // and never blocks: the capacity rule this follows treats an over-ceiling
  // assignment the same way, and on event day an admin must be able to call
  // someone in regardless of a declaration made weeks earlier.
  const unavailableConflicts = useMemo(
    () => findUnavailableAssignments(activeAssignments, unavailability),
    [activeAssignments, unavailability]
  )

  const unavailableDetails = useMemo(() => {
    const nameById = new Map(officials.map((o) => [o.id, o.name]))
    return unavailableConflicts.map((a) => ({
      officialName: nameById.get(a.official_id) ?? '—',
      time: formatSlotLabel(new Date(a.timeslot_start)),
      reason:
        unavailability.find(
          (p) => p.official_id === a.official_id && p.reason !== null && p.reason.length > 0
        )?.reason ?? null,
    }))
  }, [unavailableConflicts, officials, unavailability])

  const overCapacityCount = useMemo(
    () => uniqueIdsFromCellKeys(overCapacityCells),
    [overCapacityCells]
  )

  const doubleBookedCount = useMemo(
    () => uniqueIdsFromCellKeys(doubleBookedOfficials),
    [doubleBookedOfficials]
  )

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

    function handleUp() {
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
          wsName,
          slotIndex,
          cellStarts: validCells,
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

  // Slots the open picking surface applies to: one for a single-cell click,
  // the painted run for a drag gesture. Whichever is open feeds the same
  // candidate builder, so the two surfaces agree on who is pickable.
  const pickerCellStarts = useMemo(() => {
    if (dragOfficialPicker) return dragOfficialPicker.cellStarts
    if (wsSlotModal) return [wsSlotModal.slotStart]
    return []
  }, [dragOfficialPicker, wsSlotModal])

  const pickerCandidates = useMemo<PickerCandidate[]>(
    () =>
      pickerCellStarts.length > 0
        ? buildPickerCandidates(officials, pickerCellStarts, activeAssignments, periodsByCell)
        : [],
    [pickerCellStarts, officials, activeAssignments, periodsByCell]
  )

  // ─── Handlers ────────────────────────────────────────────────────────────

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
      const slotIdx = autosave.nextLocalFreeSlot(activeAssignments, ws.id, slotStart)
      closePickerCell()

      const key = `p:${officialId}:${slotStart}`
      beginPending(key)
      await autosave.persistAdditions([
        {
          official_id: officialId,
          workstation_id: ws.id,
          timeslot_start: slotStart,
          timeslot_end: slotEnd,
          slot_index: slotIdx,
        },
      ])
      endPending(key)
    }
    // No else branch any more. Picking a work area for an empty by-person cell
    // is now the drag picker's job — a click is just a one-slot drag — and
    // this used to open a second, older menu that offered no time-off option.
  }

  async function handleCellAction(action: 'remove' | 'assigned', assignment: LocalAssignment) {
    closeCellActionCell()
    await autosave.handleCellAction(action, assignment)
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

  async function handleDragOfficialPick(officialId: string) {
    if (!dragOfficialPicker) return
    const picker = dragOfficialPicker
    closeDragOfficialPicker()
    setDragSaving(true)
    await autosave.handleDragOfficialPick(picker, officialId)
    setDragSaving(false)
  }

  // ─── Time-off cell popup ──────────────────────────────────────────────────

  const [timeOffCell, setTimeOffCell] = useState<TimeOffCell | null>(null)
  const [removingPeriodId, setRemovingPeriodId] = useState<string | null>(null)

  // Local to this component rather than in the interaction hook: the hook owns
  // the modes that interact with each other (the three pickers close one
  // another), and this one is independent of all of them.
  useEffect(() => {
    if (!timeOffCell) return
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('[data-time-off-popup]')) setTimeOffCell(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [timeOffCell])

  function handleTimeOffClick(
    officialName: string,
    periods: UnavailabilityPeriod[],
    anchor: HTMLElement
  ) {
    if (periods.length === 0) return
    const rect = anchor.getBoundingClientRect()
    setTimeOffCell({
      officialName,
      periods,
      anchorTop: rect.bottom,
      anchorLeft: rect.left,
    })
  }

  async function handleTimeOffRemove(periodId: string) {
    setRemovingPeriodId(periodId)
    const result = await clearUnavailability({ tenantSlug, tenantId, periodId })
    setRemovingPeriodId(null)

    if (result.error) {
      toastError(result.error.startsWith('scheduling.') ? t(result.error) : result.error)
      // A refused delete leaves the period in place, so the popup would be
      // lying if it stayed open showing a row that is still there.
      if (result.notOwned) setTimeOffCell(null)
      return
    }

    setTimeOffCell(null)
    router.refresh()
  }

  // ─── Drag-to-paint (by-person rows) ───────────────────────────────────────
  //
  // The gesture mirrors the by-work-area paint, but asks a different question
  // on release: that one knows the station and asks who, this one knows the
  // person and asks what — a work area, or time off.

  function handlePersonDragStart(officialId: string, officialName: string, idx: number) {
    if (dragSaving) return
    startPersonDrag(officialId, officialName, idx)
  }

  function handlePersonDragEnter(officialId: string, idx: number) {
    updatePersonDragCurrent(officialId, idx)
  }

  // Pointer-up anywhere ends the paint, not just over a cell: releasing
  // outside the grid must not leave a drag stuck on.
  useEffect(() => {
    if (!personDrag) return

    function handleUp() {
      const drag = personDrag
      if (!drag) return
      endPersonDrag()

      const from = Math.min(drag.startIdx, drag.currentIdx)
      const to = Math.max(drag.startIdx, drag.currentIdx)
      const cellStarts = slots.slice(from, to + 1).map((s) => s.toISOString())
      if (cellStarts.length === 0) return

      openPersonDragPicker({
        officialId: drag.officialId,
        officialName: drag.officialName,
        cellStarts,
      })
    }

    document.addEventListener('pointerup', handleUp)
    return () => document.removeEventListener('pointerup', handleUp)
  }, [personDrag, slots, endPersonDrag, openPersonDragPicker])

  async function handlePersonDragPickWorkstation(workstationId: string) {
    if (!personDragPicker) return
    const picker = personDragPicker
    closePersonDragPicker()
    setDragSaving(true)
    await autosave.handlePersonPaint(picker.officialId, workstationId, picker.cellStarts)
    setDragSaving(false)
  }

  async function handlePersonDragPickTimeOff() {
    if (!personDragPicker) return
    const picker = personDragPicker
    closePersonDragPicker()
    setDragSaving(true)

    // The painted run is contiguous slots, so one period spanning the whole
    // run — not one row per cell. That is the point of storing an interval.
    const starts = picker.cellStarts.map((c) => new Date(c).getTime())
    const startsAt = new Date(Math.min(...starts)).toISOString()
    const endsAt = slotEndTime(new Date(Math.max(...starts)), granularityMin).toISOString()

    const result = await setUnavailability({
      tenantSlug,
      tenantId,
      officialId: picker.officialId,
      startsAt,
      endsAt,
    })

    setDragSaving(false)

    if (result.error) {
      toastError(result.error.startsWith('scheduling.') ? t(result.error) : result.error)
      return
    }

    // The grid reads unavailability on the server, so the new period only
    // appears once the route re-renders.
    router.refresh()
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (stages.length === 0) {
    return (
      <EmptyStateCard
        Icon={Layers}
        title={t('scheduling.noStagesTitle')}
        description={t('scheduling.noStagesHint')}
      />
    )
  }

  return (
    <div>
      <SchedulingPrintStyles />

      <SchedulingPrintHeader stageName={selectedStage?.name} selectedDay={selectedDay} />

      <SchedulingToolbar
        stages={stages}
        selectedStage={selectedStage}
        selectedStageId={selectedStageId}
        onSelectStage={handleSelectStage}
        availableDays={availableDays}
        selectedDay={selectedDay}
        onSelectDay={(day) => changeDay(day)}
        dragSaving={dragSaving}
      />

      <ConflictBanners
        overCapacityCount={overCapacityCount}
        overCapacityDetails={overCapacityDetails}
        doubleBookedCount={doubleBookedCount}
        doubleBookedDetails={doubleBookedDetails}
        unavailableDetails={unavailableDetails}
      />

      <SchedulingViewToggle view={view} onChange={setView} />

      {/* Grid */}
      {officials.length === 0 && stageWorkstations.length === 0 ? (
        <SetupEmptyState />
      ) : slots.length === 0 ? (
        <EmptyStateCard
          Icon={Clock}
          title={t('scheduling.noTimeRangeTitle')}
          description={t('scheduling.noTimeRangeHint')}
        />
      ) : view === 'by-person' ? (
        <ByPersonGrid
          slots={slots}
          granularityMin={granularityMin}
          officials={officials}
          stageWorkstations={stageWorkstations}
          activeAssignments={activeAssignments}
          doubleBookedOfficials={doubleBookedOfficials}
          unavailableSlots={unavailableSlots}
          periodsByCell={periodsByCell}
          personDrag={personDrag}
          pendingPaint={
            personDragPicker
              ? {
                  officialId: personDragPicker.officialId,
                  cellStarts: new Set(personDragPicker.cellStarts),
                }
              : null
          }
          onPersonDragStart={handlePersonDragStart}
          onPersonDragEnter={handlePersonDragEnter}
          onTimeOffClick={handleTimeOffClick}
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

      {timeOffCell && (
        <TimeOffPopup
          cell={timeOffCell}
          onRemove={handleTimeOffRemove}
          removingId={removingPeriodId}
        />
      )}

      {personDragPicker && (
        <PersonDragPicker
          picker={personDragPicker}
          openWorkstations={stageWorkstations.filter((ws) =>
            personDragPicker.cellStarts.every((cs) =>
              isWithinWindow(new Date(cs), granularityMin, ws.workstation_operating_windows)
            )
          )}
          // Occupancy at the painted slots. The max rather than a per-slot
          // figure: the picker offers one choice for the whole run, so the
          // number that matters is the tightest slot in it.
          countFor={(wsId) =>
            Math.max(
              ...personDragPicker.cellStarts.map(
                (cs) =>
                  activeAssignments.filter(
                    (a) => a.workstation_id === wsId && a.timeslot_start === cs
                  ).length
              )
            )
          }
          onPickWorkstation={handlePersonDragPickWorkstation}
          onPickTimeOff={handlePersonDragPickTimeOff}
          onClose={closePersonDragPicker}
        />
      )}

      {/* One picking surface for both gestures: a single-cell click on a
          by-work-area expanded row, and a drag-painted run of cells. */}
      {wsSlotModal && (
        <WsSlotModal
          title={t('scheduling.slotModalTitle', {
            index: wsSlotModal.slotIndex,
            ws: wsSlotModal.wsName,
            time: formatSlotLabel(new Date(wsSlotModal.slotStart)),
          })}
          listLabel={t('scheduling.slotModalAvailable', {
            time: formatSlotLabel(new Date(wsSlotModal.slotStart)),
          })}
          candidates={pickerCandidates}
          search={wsSlotModalSearch}
          onSearchChange={setWsSlotModalSearch}
          assignedInSlot={activeAssignments.filter(
            (a) =>
              a.workstation_id === wsSlotModal.workstationId &&
              a.timeslot_start === wsSlotModal.slotStart &&
              a.slot_index === wsSlotModal.slotIndex
          )}
          officials={officials}
          onRemove={handleWsSlotRemove}
          onAdd={handleWsSlotAdd}
          onClose={closeWsSlotModal}
        />
      )}

      {dragOfficialPicker && (
        <WsSlotModal
          title={t('scheduling.dragPaintPickPerson', {
            count: dragOfficialPicker.cellStarts.length,
          })}
          listLabel={t('scheduling.dragPaintRange', {
            ws: dragOfficialPicker.wsName,
            from: formatSlotLabel(new Date(dragOfficialPicker.cellStarts[0]!)),
            to: formatSlotLabel(
              new Date(dragOfficialPicker.cellStarts[dragOfficialPicker.cellStarts.length - 1]!)
            ),
          })}
          candidates={pickerCandidates}
          search={dragPickerSearch}
          onSearchChange={setDragPickerSearch}
          // A painted run only covers cells that were empty, so there is
          // never anything to offer removal for here.
          assignedInSlot={[]}
          officials={officials}
          onAdd={handleDragOfficialPick}
          onClose={closeDragOfficialPicker}
          // Opened from the drag's own `pointerup`, so the release that ends
          // the drag must not choose the row it lands on.
          openedMidGesture
        />
      )}

      <SchedulingWarningLegend />
    </div>
  )
}

import { slotEndTime } from '@/lib/scheduling/grid-logic'
import type { SaveAssignmentsResult } from '../actions'
import { dominantAuthor, type UnavailabilityPeriod } from '@/lib/scheduling/unavailability'
import type {
  LocalAssignment,
  OfficialData,
  PickerCandidate,
  PickerStatus,
  WorkstationData,
} from './scheduling-types'

export const STRIPED_UNAVAILABLE_STYLE = {
  background:
    'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)',
}

// An absence the official declared, NOT the same thing as a closed operating
// window. Grey above means "the work area is shut, nothing can go here";
// amber here means "this person is not available". Both are hard blocks since
// Peter's call of 2026-10-07, but they are blocked for different reasons and
// an admin resolves them differently.
//
// Opposite diagonal as well as a different hue, so the two stay distinguishable
// for a viewer who cannot rely on colour.
export const STRIPED_TIME_OFF_STYLE = {
  background:
    'repeating-linear-gradient(-45deg, #fdba74, #fdba74 3px, transparent 3px, transparent 8px)',
}

// Time off the ORGANISERS recorded, as opposed to the official's own
// declaration above. Slate rather than amber, same diagonal: the two are the
// same kind of thing (a person blocked) from two different authors, so they
// share a direction and differ in hue — where the grey outside-window hatch
// differs in both, because it is a different kind of thing entirely.
export const STRIPED_TIME_OFF_ADMIN_STYLE = {
  background:
    'repeating-linear-gradient(-45deg, #94a3b8, #94a3b8 3px, transparent 3px, transparent 8px)',
}

export function toLocalAssignments(
  inserted: NonNullable<SaveAssignmentsResult['inserted']>,
  granularityMin: number
): LocalAssignment[] {
  return inserted.map((r) => ({
    id: r.id,
    official_id: r.official_id,
    workstation_id: r.workstation_id!,
    timeslot_start: new Date(r.timeslot_start).toISOString(),
    timeslot_end: slotEndTime(new Date(r.timeslot_start), granularityMin).toISOString(),
    status: 'assigned',
    slot_index: r.slot_index,
  }))
}

// Reads from the unfiltered assignment list, not the current stage's active assignments —
// a conflicting assignment can belong to a different stage's workstation and would
// otherwise be invisible to the cell-action popup.
export function getAssignmentsForCell(
  assignments: LocalAssignment[],
  officialId: string,
  slotStart: string
): LocalAssignment[] {
  return assignments.filter((a) => a.official_id === officialId && a.timeslot_start === slotStart)
}

// Assignments beyond a workstation's capacity ceiling, grouped by timeslot — backs the
// "+N" overflow indicator and its click-to-pick-which-one-to-remove popup.
export function getOverflowBySlot(
  activeAssignments: LocalAssignment[],
  workstationId: string,
  capacityCeiling: number
): Map<string, LocalAssignment[]> {
  const overflowBySlot = new Map<string, LocalAssignment[]>()
  for (const a of activeAssignments) {
    if (a.workstation_id !== workstationId) continue
    if (a.slot_index !== null && a.slot_index > capacityCeiling) {
      const arr = overflowBySlot.get(a.timeslot_start) ?? []
      arr.push(a)
      overflowBySlot.set(a.timeslot_start, arr)
    }
  }
  return overflowBySlot
}

export function applyCellAction(
  assignments: LocalAssignment[],
  action: 'remove' | 'assigned',
  assignmentId: string
): LocalAssignment[] {
  if (action === 'remove') {
    return assignments.filter((a) => a.id !== assignmentId)
  }
  return assignments.map((a) => (a.id === assignmentId ? { ...a, status: action } : a))
}

// Cell-action popup shows one row per conflicting assignment: the other work area name
// when the conflict is double-booking (labelBy: 'workArea'), or the other official's name
// when the conflict is an over-capacity/overflow work area (labelBy: 'official').
export function resolveCellActionLabel(
  labelBy: 'workArea' | 'official',
  assignment: LocalAssignment,
  officials: OfficialData[],
  workstations: WorkstationData[]
): string {
  if (labelBy === 'official') {
    return officials.find((o) => o.id === assignment.official_id)?.name ?? '—'
  }
  return workstations.find((w) => w.id === assignment.workstation_id)?.name ?? '—'
}

/** Sort order for the picker list: free first, then the unpickable ones. */
const STATUS_ORDER: Record<PickerStatus, number> = {
  available: 0,
  timeOff: 1,
  timeOffAdmin: 2,
  assigned: 3,
}

/** Which statuses make a person unpickable. */
export const BLOCKED_PICKER_STATUSES: ReadonlySet<PickerStatus> = new Set<PickerStatus>([
  'timeOff',
  'timeOffAdmin',
  'assigned',
])

export function sortCandidates(candidates: PickerCandidate[]): PickerCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.official.name.localeCompare(b.official.name)
  )
}

/**
 * Why each official is or is not a pick across a run of one or more slots.
 *
 * Both picking surfaces go through here — a single-cell click passes one
 * slot, a drag-paint gesture passes the run it painted — so the two can never
 * disagree about who is pickable. A run is only pickable if the person is
 * free across ALL of its slots, since one pick writes an assignment to every
 * one of them. Blocked people are returned rather than dropped: the modal
 * shows them disabled, so an admin hunting for someone finds them with a
 * reason instead of an unexplained absence.
 */
export function buildPickerCandidates(
  officials: OfficialData[],
  cellStarts: string[],
  activeAssignments: LocalAssignment[],
  periodsByCell: Map<string, UnavailabilityPeriod[]>
): PickerCandidate[] {
  const busy = new Set(
    activeAssignments.filter((a) => cellStarts.includes(a.timeslot_start)).map((a) => a.official_id)
  )
  return officials.map((off) => {
    let status: PickerStatus = 'available'
    if (busy.has(off.id)) {
      status = 'assigned'
    } else {
      const periods = cellStarts.flatMap((cs) => periodsByCell.get(`${off.id}:${cs}`) ?? [])
      if (periods.length > 0) {
        status = dominantAuthor(periods) === 'tenant_admin' ? 'timeOffAdmin' : 'timeOff'
      }
    }
    return { official: off, status }
  })
}

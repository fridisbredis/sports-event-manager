import { slotEndTime } from '@/lib/scheduling/grid-logic'
import type { SaveAssignmentsResult } from '../actions'
import type { LocalAssignment, OfficialData, WorkstationData } from './scheduling-types'

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

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

// `backgroundAttachment: 'fixed'` anchors the gradient to the viewport rather
// than to each cell that paints it, so every cell of a run shares one pattern
// origin and the diagonals carry across the seams unbroken.
//
// The earlier approach phase-shifted each cell by its offset into the run,
// which required knowing the rendered cell width in px. The grids are
// `table-fixed w-full`, where the `w-20` on the header is a hint the browser
// is free to overrule when it distributes leftover width — so the constant
// drifted from the real width and the diagonals visibly stepped at every
// cell boundary. Anchoring to the viewport needs no width at all.
export const STRIPED_UNAVAILABLE_STYLE = {
  background:
    'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)',
  backgroundAttachment: 'fixed',
} as const

// An absence the official declared, NOT the same thing as a closed operating
// window. The grey hatch above means "the work area is shut, nothing can go
// here"; these mean "this person is not available". Both are hard blocks
// since Peter's call of 2026-10-07, but they are blocked for different
// reasons and an admin resolves them differently.
//
// Flat fills rather than diagonals: a hatch at this density read as texture
// competing with the schedule itself, and a run of them striped the row. The
// fill is pale enough to sit behind the grid, and a calendar-off icon in the
// middle of each run carries the meaning the stripes used to.
//
// The border keeps a pale fill from dissolving into the white grid: without
// it a blocked cell reads as a gap where the row simply stops, rather than
// as a block that is deliberately occupied.
//
// Border COLOUR only — the caller adds the width. The grid draws a run's
// interior edges without one, so the fill stays continuous across it, and
// only the run's outer sides are bordered; a width baked in here would put a
// line through the middle of every run.
export const TIME_OFF_FILL = {
  self: 'bg-amber-50 border-amber-200',
  admin: 'bg-slate-100 border-slate-300',
} as const

// The icon tint for each fill, dark enough to read on it.
export const TIME_OFF_ICON = {
  self: 'text-amber-500',
  admin: 'text-slate-400',
} as const

/**
 * Rounded corners and seam-suppression for one cell of a horizontal run.
 *
 * Only the outer edges of a run stay rounded; interior seams go square so the
 * run reads as a single block. Returns the class fragment only — callers keep
 * owning the cell's own sizing and colour.
 */
export function runEdgeClasses(sameAsLeft: boolean, sameAsRight: boolean): string {
  if (!sameAsLeft && !sameAsRight) return 'rounded-md'
  if (!sameAsLeft) return 'rounded-l-md'
  if (!sameAsRight) return 'rounded-r-md'
  return ''
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

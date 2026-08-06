import { slotEndTime } from '@/lib/scheduling/grid-logic'
import type { SaveAssignmentsResult } from '../actions'
import type { LocalAssignment } from './scheduling-types'

export const STRIPED_UNAVAILABLE_STYLE = {
  background: 'repeating-linear-gradient(45deg, #e5e7eb, #e5e7eb 3px, transparent 3px, transparent 8px)',
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

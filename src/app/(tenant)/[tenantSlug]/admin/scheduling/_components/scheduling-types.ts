export interface Stage {
  id: string
  name: string
  stage_type: string
  stage_date: string | null
  start_time: string | null
  end_time: string | null
}

export interface OperatingWindow {
  id: string
  window_start: string
  window_end: string
}

export interface WorkstationData {
  id: string
  name: string
  /** Palette name chosen by an admin; null falls back to hashing the id. */
  color: string | null
  capacity_ceiling: number
  stage_id: string | null
  workstation_operating_windows: OperatingWindow[]
}

export interface OfficialData {
  id: string
  name: string
  invite_status: string
  avatar_url: string | null
}

export interface AssignmentData {
  id: string
  official_id: string
  workstation_id: string | null
  timeslot_start: string
  timeslot_end: string
  status: string
  slot_index: number | null
}

export interface LocalAssignment {
  id: string | null
  official_id: string
  workstation_id: string
  timeslot_start: string
  timeslot_end: string
  status: string
  slot_index: number | null
}

export type SchedulingView = 'by-person' | 'by-work-area'

/**
 * Why an official is or is not a pick for a slot or a painted run of slots.
 *
 * Shared by both picking surfaces — the slot modal opened from a single cell
 * and the one opened by a drag-paint gesture — so the two can never drift
 * apart on what counts as unpickable. Ordered by how much it discourages
 * picking, which is also the order the list sorts in: free first, then the
 * ones that cannot be picked at all.
 */
export type PickerStatus = 'available' | 'timeOff' | 'timeOffAdmin' | 'assigned'

export interface PickerCandidate {
  official: OfficialData
  status: PickerStatus
}

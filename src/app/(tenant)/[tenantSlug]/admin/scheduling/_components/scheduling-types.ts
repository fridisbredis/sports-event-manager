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
  capacity_ceiling: number
  stage_id: string | null
  workstation_operating_windows: OperatingWindow[]
}

export interface OfficialData {
  id: string
  name: string
  invite_status: string
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

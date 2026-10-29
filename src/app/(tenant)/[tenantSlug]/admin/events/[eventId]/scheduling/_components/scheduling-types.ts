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

/**
 * The right edge of the frozen first column, in both grid views.
 *
 * This gradient is the whole edge — the cells carry no `border-r`. A hard
 * line plus a gradient reads as two separate edges once you look closely,
 * and a flat border alone fails at the job anyway: when a cell scrolls
 * underneath, the column and the content behind it meet as two flat
 * surfaces, so the eye reads the hidden cells as missing rather than as
 * covered. The gradient makes the column sit above the grid, which is what
 * tells you there is more to the left of what you can see.
 *
 * It only earns its place once something is actually hidden behind the
 * column. At scroll offset 0 there is nothing to cast onto and it reads as a
 * grey band down an unbroken white surface, so the grids fade it in from
 * `useHorizontalScrollShadow` instead of painting it unconditionally.
 *
 * It has to be drawn as a pseudo-element rather than the obvious
 * `box-shadow`: both grids are `border-collapse`, where the table owns the
 * cell edges and a shadow set on a `td` is simply not painted. The gradient
 * lives inside the cell box, which collapsing does not touch, and being
 * absolutely positioned it costs no layout width in a `table-fixed` grid
 * whose columns are sized to the slot count.
 */
export const STICKY_COL_SHADOW =
  "after:pointer-events-none after:absolute after:inset-y-0 after:left-full after:w-1.5 after:bg-gradient-to-r after:from-[rgba(17,24,39,0.06)] after:to-transparent after:content-[''] after:transition-opacity after:duration-150"

/** Paired with {@link STICKY_COL_SHADOW}: hides the edge until scrolled. */
export const STICKY_COL_SHADOW_HIDDEN = 'after:opacity-0'

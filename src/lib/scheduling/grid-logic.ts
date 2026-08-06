import { getAllocableRange, getAllocableDays } from './allocable-range'

// ─── Types ───────────────────────────────────────────────────────────────────
// Structural (not imported from the component) so this module has no dependency
// on scheduling-grid.tsx and can be unit-tested in isolation.

export interface StageWindow {
  stage_type: string
  start_time: string | null
  end_time: string | null
}

export interface OperatingWindow {
  window_start: string
  window_end: string
}

export interface WorkstationCapacity {
  id: string
  capacity_ceiling: number
}

export interface AssignmentLike {
  official_id: string
  workstation_id: string | null
  timeslot_start: string
}

export interface OfficialLike {
  id: string
  name: string
}

export interface WorkstationLike {
  id: string
  name: string
}

export interface DoubleBookedDetail {
  officialName: string
  time: string
  workAreaNames: string[]
}

// ─── Stage / slot helpers ──────────────────────────────────────────────────

export function getCurrentStage<T extends StageWindow>(stages: T[]): T | undefined {
  const now = new Date()
  return stages.find((stage) => {
    const range = getAllocableRange(stage)
    if (!range) return false
    return now >= new Date(range.start) && now <= new Date(range.end)
  })
}

export function generateSlotsForDay<T extends StageWindow>(
  stage: T,
  day: string,
  granularityMin: number
): Date[] {
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

export function slotEndTime(slot: Date, granularityMin: number): Date {
  const end = new Date(slot)
  end.setMinutes(end.getMinutes() + granularityMin)
  return end
}

export function isWithinWindow(
  slot: Date,
  granMin: number,
  windows: OperatingWindow[]
): boolean {
  if (windows.length === 0) return true
  const slotEnd = slotEndTime(slot, granMin)
  return windows.some((w) => {
    const wStart = new Date(w.window_start)
    const wEnd = new Date(w.window_end)
    return slot >= wStart && slotEnd <= wEnd
  })
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

export function formatDayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  return date.toLocaleDateString('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function formatSlotLabel(slot: Date): string {
  return slot.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

export function formatSlotDateTimeLabel(slot: Date): string {
  const date = slot.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${date} ${formatSlotLabel(slot)}`
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

// ─── Conflict detection ──────────────────────────────────────────────────────
// These two power the warning badges in both grid views: over-capacity cells
// in the by-work-area view, and double-booked officials in the by-person view.

export function computeOverCapacityCells(
  activeAssignments: AssignmentLike[],
  stageWorkstations: WorkstationCapacity[]
): Set<string> {
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
}

export function computeDoubleBookedOfficials(assignments: AssignmentLike[]): Set<string> {
  const result = new Set<string>()
  const seenSlots = new Map<string, string>()
  for (const a of assignments) {
    const key = `${a.official_id}:${a.timeslot_start}`
    if (seenSlots.has(key) && seenSlots.get(key) !== a.workstation_id) {
      result.add(key)
    } else {
      seenSlots.set(key, a.workstation_id ?? '')
    }
  }
  return result
}

export function computeDoubleBookedDetails(
  doubleBookedOfficials: Set<string>,
  assignments: AssignmentLike[],
  officials: OfficialLike[],
  workstations: WorkstationLike[]
): DoubleBookedDetail[] {
  const details: DoubleBookedDetail[] = []
  for (const key of doubleBookedOfficials) {
    const [officialId, timeslotStart] = key.split(/:(.+)/)
    const official = officials.find((o) => o.id === officialId)
    if (!official) continue
    const conflictingAssignments = assignments.filter(
      (a) => a.official_id === officialId && a.timeslot_start === timeslotStart
    )
    const workAreaNames = conflictingAssignments
      .map((a) => workstations.find((w) => w.id === a.workstation_id)?.name ?? '—')
      .filter((n, i, arr) => arr.indexOf(n) === i)
    details.push({
      officialName: official.name,
      time: formatSlotDateTimeLabel(new Date(timeslotStart)),
      workAreaNames,
    })
  }
  return details
}

// A page left open across a deploy calls a Server Action ID the new server
// no longer recognizes (Container App is in single-revision mode, so every
// deploy fully swaps the process). Without this, the throw skips
// endPending/setDragSaving and the cell shows its loading Skeleton forever.
export function saveErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('Failed to find Server Action')) {
    return 'This page is out of date. Please reload the page to continue.'
  }
  return 'Something went wrong while saving. Please try again.'
}

export { getAllocableRange, getAllocableDays }

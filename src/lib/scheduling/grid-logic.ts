import { getAllocableRange, getAllocableDays } from './allocable-range'
import { dateLocaleFor } from '@/lib/i18n/date-locale'

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

export interface OverCapacityDetail {
  workAreaName: string
  time: string
  count: number
  ceiling: number
  officialNames: string[]
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

  const dayStart = new Date(`${day}T00:00:00.000Z`).getTime()
  const dayEnd = new Date(`${day}T23:59:59.999Z`).getTime()

  const rangeStart = new Date(range.start).getTime()
  const rangeEnd = new Date(range.end).getTime()

  const end = Math.min(rangeEnd, dayEnd)

  // The slot grid is phased from the START OF THE RANGE, not from midnight.
  //
  // Clamping the first slot of each day to dayStart instead would restart the
  // grid at 00:00 every day, which silently drops every slot between midnight
  // and the first aligned step on any stage that crosses a day boundary with
  // an unaligned start time: a stage running 21:07 → 00:37 at 15-minute
  // granularity would produce 21:07, 21:22 … 23:52 on the first day and then
  // 00:00, 00:15, 00:30 on the second, so 00:07 and 00:22 — both inside the
  // allocable range — would have no cell and could not be staffed.
  //
  // Stepping forward in whole granularity units from rangeStart keeps one
  // continuous grid across midnight. See allocable-invariant.test.ts.
  const stepMs = granularityMin * 60 * 1000
  const stepsToDay = Math.max(0, Math.ceil((dayStart - rangeStart) / stepMs))
  const start = rangeStart + stepsToDay * stepMs

  if (start >= end) return []

  const slots: Date[] = []
  for (let t = start; t < end; t += stepMs) {
    slots.push(new Date(t))
  }
  return slots
}

export function slotEndTime(slot: Date, granularityMin: number): Date {
  const end = new Date(slot)
  end.setMinutes(end.getMinutes() + granularityMin)
  return end
}

export function isWithinWindow(slot: Date, granMin: number, windows: OperatingWindow[]): boolean {
  if (windows.length === 0) return true

  const slotStartMs = slot.getTime()
  const slotEndMs = slotEndTime(slot, granMin).getTime()

  // Covered by the windows TOGETHER, not by any single one.
  //
  // A round-the-clock work area is stored as one window per calendar day
  // (expandWindows in admin/workstations/_utils.ts builds them that way), so
  // its windows meet exactly at midnight: 16th 00:00→17th 00:00, 17th
  // 00:00→18th 00:00. A slot that straddles that seam — 23:15→00:15 at
  // 60-minute granularity — fits inside NEITHER window, and asking "does any
  // one window contain it" hatched it as closed even though the area is open
  // continuously on both sides of it.
  //
  // So: sort the windows, walk them merging any that touch or overlap, and
  // ask whether one merged run covers the slot end to end. Windows that do
  // not meet still leave a real gap, and a slot falling in one is still
  // closed — which is the case this check exists for.
  const sorted = [...windows]
    .map((w) => ({
      start: new Date(w.window_start).getTime(),
      end: new Date(w.window_end).getTime(),
    }))
    .sort((a, b) => a.start - b.start)

  let runStart = sorted[0].start
  let runEnd = sorted[0].end

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= runEnd) {
      // Touches or overlaps the run in progress — extend it.
      runEnd = Math.max(runEnd, sorted[i].end)
      continue
    }
    if (slotStartMs >= runStart && slotEndMs <= runEnd) return true
    runStart = sorted[i].start
    runEnd = sorted[i].end
  }

  return slotStartMs >= runStart && slotEndMs <= runEnd
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

// `language` is the UI language of the current render, threaded in from the
// caller's useLanguage(): these are pure helpers with no hook of their own, and
// the weekday and month names they produce have to match the surrounding text.
// Omitting it falls back to the regional default rather than the browser's
// locale, so a missed call site degrades to Swedish names, never to 10/8/2026.
// The weekday width is a per-locale convention, not a global preference. The
// selector is a fixed-width control, and English spells its weekdays out long
// enough that "Wednesday, 12 Aug" crowds it, while Swedish abbreviates to a
// bare "ons" that reads as a stub next to the full month. So English takes the
// locale's short weekday ("Sun, 12 Jul") and Swedish its long one
// ("söndag 2 aug."), which is what Peter asked for on both sides.
const DAY_LABEL_WEEKDAY: Record<string, 'short' | 'long'> = {
  en: 'short',
}

export function formatDayLabel(day: string, language?: string): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  return date.toLocaleDateString(dateLocaleFor(language), {
    weekday: DAY_LABEL_WEEKDAY[language ?? ''] ?? 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function formatSlotLabel(slot: Date, language?: string): string {
  return slot.toLocaleTimeString(dateLocaleFor(language), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

export function formatSlotDateTimeLabel(slot: Date, language?: string): string {
  const date = slot.toLocaleDateString(dateLocaleFor(language), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  return `${date} ${formatSlotLabel(slot, language)}`
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

export function computeOverCapacityDetails(
  overCapacityCells: Set<string>,
  activeAssignments: AssignmentLike[],
  stageWorkstations: (WorkstationLike & WorkstationCapacity)[],
  officials: OfficialLike[],
  language?: string
): OverCapacityDetail[] {
  const details: OverCapacityDetail[] = []
  for (const key of overCapacityCells) {
    const [wsId, timeslotStart] = key.split(/:(.+)/)
    const ws = stageWorkstations.find((w) => w.id === wsId)
    if (!ws) continue
    const cellAssignments = activeAssignments.filter(
      (a) => a.workstation_id === wsId && a.timeslot_start === timeslotStart
    )
    const officialNames = cellAssignments.map(
      (a) => officials.find((o) => o.id === a.official_id)?.name ?? '—'
    )
    details.push({
      workAreaName: ws.name,
      time: formatSlotDateTimeLabel(new Date(timeslotStart), language),
      count: cellAssignments.length,
      ceiling: ws.capacity_ceiling,
      officialNames,
    })
  }
  return details
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

// Cell keys from computeOverCapacityCells/computeDoubleBookedOfficials are
// "<id>:<timeslotStart>" — one entry per offending slot, so a single
// work area or official flagged across several timeslots would otherwise be
// counted once per slot. Warning counts (the dashboard summary tile, the
// grid's own badge counts) want one count per distinct id instead.
export function uniqueIdsFromCellKeys(cellKeys: Set<string>): number {
  const ids = new Set<string>()
  for (const key of cellKeys) ids.add(key.split(':')[0])
  return ids.size
}

export function computeDoubleBookedDetails(
  doubleBookedOfficials: Set<string>,
  assignments: AssignmentLike[],
  officials: OfficialLike[],
  workstations: WorkstationLike[],
  language?: string
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
      time: formatSlotDateTimeLabel(new Date(timeslotStart), language),
      workAreaNames,
    })
  }
  return details
}

export { getAllocableRange, getAllocableDays }

import { Time } from '@internationalized/date'
import { getAllocableDays } from '@/lib/scheduling/allocable-range'

export interface Stage {
  id: string
  name: string
  stage_type: string
  start_time: string | null
  end_time: string | null
}

export interface TimeWindow {
  start: string
  end: string
  limitToDay: string | null
}

// Duration in minutes between two "HH:MM" wall-clock times, treating end <= start
// as rolling over to the next day (matches the overnight handling in expandWindows).
export function windowDurationMin(start: string, end: string): number {
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  const startMin = toMinutes(start)
  const endMin = toMinutes(end)
  return endMin <= startMin ? endMin + 24 * 60 - startMin : endMin - startMin
}

// Thin null-safe wrapper so callers here don't each need their own
// `stage ?? ` guard before reaching the grid's own day-range logic.
export function getStageDays(stage: Stage | null): string[] {
  if (!stage?.start_time || !stage?.end_time) return []
  return getAllocableDays(stage)
}

// A day + "HH:MM" pair, rolled to the next calendar day when `overnight` is
// true, as an ISO instant.
function rolloverEndInstant(day: string, endHHMM: string, overnight: boolean): Date {
  const d = new Date(`${day}T${endHHMM}:00Z`)
  if (overnight) d.setUTCDate(d.getUTCDate() + 1)
  return d
}

export function expandWindows(
  windows: TimeWindow[],
  stageDays: string[],
  stageStart: string | null
): { window_start: string; window_end: string }[] {
  const lastDay = stageDays[stageDays.length - 1] ?? null

  return windows
    .filter((w) => w.start && w.end)
    .flatMap((w) => {
      let days: string[]
      if (w.limitToDay) {
        days = [w.limitToDay]
      } else {
        days = stageDays
        if (stageDays.length > 0 && stageStart) {
          const stageStartHHMM = stageStart.slice(11, 16)
          if (w.start < stageStartHHMM) {
            days = stageDays.slice(1)
          }
        }
        // A recurring overnight window (end <= start, e.g. a full 00:00->00:00
        // day) always rolls into the next calendar day — which, on the
        // stage's last day, is past the stage's own end time. It would
        // collide with a separate window explicitly limited to that last day
        // to cap it there.
        //
        // Test stageDays.length here, not the post-slice `days.length`: the
        // slice above (for a window starting before the stage's own start
        // time) already shrinks `days` to stageDays.length - 1 on its own,
        // so on a 2-day stage `days.length > 1` would never be true and this
        // guard would silently never fire, letting the collision through.
        if (stageDays.length > 1 && w.end <= w.start && days[days.length - 1] === lastDay) {
          days = days.slice(0, -1)
        }
      }
      return days.map((day) => {
        const overnight = w.end <= w.start
        const endInstant = rolloverEndInstant(day, w.end, overnight)
        return {
          window_start: `${day}T${w.start}`,
          window_end: endInstant.toISOString().slice(0, 16),
        }
      })
    })
}

// Builds the minimal set of windows that exactly covers the stage's own
// allocable range (its raw hours, or the ±1h buffer around a race — whichever
// stageStartHHMM/stageEndHHMM were derived from). Replaces whatever windows
// exist with a clean baseline the admin can then split into extra shifts by
// adding more day-limited windows alongside these.
export function matchStageHoursWindows(
  stageDays: string[],
  stageStartHHMM: string | null,
  stageEndHHMM: string | null
): TimeWindow[] {
  if (stageDays.length === 0 || !stageStartHHMM || !stageEndHHMM) return []

  if (stageDays.length === 1) {
    return [{ start: stageStartHHMM, end: stageEndHHMM, limitToDay: null }]
  }

  return [
    { start: stageStartHHMM, end: '00:00', limitToDay: stageDays[0] },
    { start: '00:00', end: '00:00', limitToDay: null },
    { start: '00:00', end: stageEndHHMM, limitToDay: stageDays[stageDays.length - 1] },
  ]
}

// Windows are stored and compared as plain "HH:MM" wall-clock strings with no
// associated date or timezone, so TimeInput is given a plain `Time` value —
// never CalendarDateTime/ZonedDateTime — to avoid any browser-timezone conversion.
export function hhmmToTime(hhmm: string): Time | undefined {
  if (!hhmm) return undefined
  const [h, m] = hhmm.split(':').map(Number)
  return new Time(h, m)
}

export function timeToHHMM(time: Time | null): string {
  if (!time) return ''
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
}

// Reconstruct per-window state from stored timestamps.
// For multi-day stages, a window that appears exactly once is treated as limited to that day.
// A window that appears on multiple days is recurring (limitToDay: null), deduplicated by HH:MM.
// For single-day stages, just strip to HH:MM.
export function initWindowsFromStored(
  stored: { window_start: string; window_end: string }[],
  stageDays: string[]
): TimeWindow[] {
  if (stored.length === 0) return [{ start: '', end: '', limitToDay: null }]

  const sorted = [...stored].sort((a, b) => a.window_start.localeCompare(b.window_start))

  if (stageDays.length > 1) {
    // Count occurrences per HH:MM pair
    const counts = new Map<string, number>()
    for (const w of sorted) {
      const key = `${w.window_start.slice(11, 16)}|${w.window_end.slice(11, 16)}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    const seen = new Set<string>()
    const result: TimeWindow[] = []
    for (const w of sorted) {
      const start = w.window_start.slice(11, 16)
      const end = w.window_end.slice(11, 16)
      const key = `${start}|${end}`
      if (!seen.has(key)) {
        seen.add(key)
        const isLimited = (counts.get(key) ?? 0) === 1
        result.push({
          start,
          end,
          limitToDay: isLimited ? w.window_start.slice(0, 10) : null,
        })
      }
    }
    return result.length > 0 ? result : [{ start: '', end: '', limitToDay: null }]
  }

  return sorted.map((w) => ({
    start: w.window_start.slice(11, 16),
    end: w.window_end.slice(11, 16),
    limitToDay: null,
  }))
}

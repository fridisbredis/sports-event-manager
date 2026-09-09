// Day-window helpers for MYSCH-01's `?day=` read (PERF-06).
//
// All schedule days are UTC calendar days. `timeslot_start` is stored as a
// timestamptz and every existing formatter on the official surface renders it
// with `timeZone: 'UTC'`, so the day a shift belongs to is the first ten
// characters of its ISO string — not a local-time derivation, which would put
// an 01:00 shift on the previous day for a viewer west of UTC and disagree
// with the day header rendered next to it.
//
// `admin/scheduling/page.tsx` builds the same window inline. It is
// deliberately not refactored onto this helper here: that page is outside this
// change's scope and works as written.

export interface DayWindow {
  /** Inclusive lower bound, ISO. */
  start: string
  /** Exclusive upper bound, ISO — the next day's start. */
  end: string
}

/** The UTC calendar day (`YYYY-MM-DD`) a timestamp belongs to. */
export function dayKey(timestamp: string): string {
  return timestamp.slice(0, 10)
}

/** Distinct UTC days present in a set of timestamps, ascending. */
export function distinctDays(timestamps: string[]): string[] {
  const seen = new Set<string>()
  for (const ts of timestamps) seen.add(dayKey(ts))
  return [...seen].sort()
}

/**
 * Half-open ISO bounds for one UTC calendar day, for a
 * `.gte(start).lt(end)` pair. Half-open rather than `.lte` on 23:59:59 so a
 * shift starting exactly at midnight belongs to one day only.
 */
export function dayWindow(day: string): DayWindow {
  const start = new Date(`${day}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

/**
 * Which day the view should open on: the requested one when it is a day the
 * official actually works, otherwise today, otherwise their first day.
 *
 * The validation is the same defensive posture as `admin/scheduling`'s
 * `?day=`/`?stage=` handling — a stale or hand-edited param must not put the
 * view on a day the official has no shifts on, which would render as an empty
 * schedule and read exactly like the F-REL-10 failure this page is the sharp
 * edge of.
 */
export function resolveSelectedDay(
  requested: string | undefined,
  availableDays: string[],
  today: string
): string | null {
  if (requested && availableDays.includes(requested)) return requested
  if (availableDays.includes(today)) return today
  return availableDays[0] ?? null
}

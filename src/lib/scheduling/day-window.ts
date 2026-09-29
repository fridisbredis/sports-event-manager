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

/** A run of back-to-back slots, collapsed into one span. */
export interface TimeSpan {
  /** ISO start of the first slot in the run. */
  start: string
  /** ISO end of the last slot in the run. */
  end: string
}

/**
 * Collapses consecutive slots into contiguous spans.
 *
 * One `assignments` row is exactly one grid slot — `timeslot_end` is written
 * as `timeslot_start + scheduling_granularity_min` (`slotEndTime`) — so an
 * official working 11:00–17:00 at a 1h granularity has seven rows, and
 * MYSCH-01 listing every start time is what made that line unreadable.
 *
 * Adjacency is tested on `end === next start` rather than on the event's
 * granularity: the boundary is what actually decides whether two slots touch,
 * it needs no extra prop threaded down from the event, and it stays correct
 * if a tenant ever changes `scheduling_granularity_min` mid-event — rows
 * written before the change keep their old width, and a granularity-based
 * comparison would then merge across a real gap.
 *
 * Slots are compared as instants, not strings, so `...T11:00:00+00:00` and
 * `...T11:00:00.000Z` — both shapes PostgREST can return — still join up.
 *
 * Input must be ascending by `start`; the page's queries already `.order` it.
 */
export function mergeContiguousSlots(
  slots: { timeslot_start: string; timeslot_end: string }[]
): TimeSpan[] {
  const spans: TimeSpan[] = []
  for (const slot of slots) {
    const last = spans[spans.length - 1]
    if (last && new Date(last.end).getTime() === new Date(slot.timeslot_start).getTime()) {
      // Guard against an out-of-order or overlapping row shortening a span.
      if (new Date(slot.timeslot_end).getTime() > new Date(last.end).getTime()) {
        last.end = slot.timeslot_end
      }
    } else {
      spans.push({ start: slot.timeslot_start, end: slot.timeslot_end })
    }
  }
  return spans
}

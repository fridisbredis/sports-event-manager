// Self-reported unavailability: the pure logic shared by the official's
// declaration screen (MYSCH-01) and the admin grid's overlay (SCHED-01).
//
// Kept free of React and of Supabase so both sides agree on exactly one
// definition of "does this period cover this slot" — the two screens render
// the same fact from opposite directions, and a disagreement between them is
// the failure mode that makes the feature untrustworthy.

/**
 * A point in time, in any of the shapes this module's callers hold one in:
 * an ISO string from the database, a Date from the grid's slot list, or an
 * epoch millisecond count already derived from one.
 */
export type Instant = string | Date | number

/** One declared period, as stored. */
export interface UnavailabilityPeriod {
  id: string
  official_id: string
  starts_at: string
  ends_at: string
  reason: string | null
}

/**
 * Half-open overlap test: `[aStart, aEnd)` against `[bStart, bEnd)`.
 *
 * Half-open is what makes back-to-back periods not overlap — an absence
 * ending 15:00 and a shift starting 15:00 are adjacent, not in conflict. The
 * CHECK constraint on official_unavailability and this test share that
 * convention deliberately; if one used closed intervals every boundary would
 * read as a conflict.
 */
export function periodsOverlap(
  aStart: Instant,
  aEnd: Instant,
  bStart: Instant,
  bEnd: Instant
): boolean {
  const as = new Date(aStart).getTime()
  const ae = new Date(aEnd).getTime()
  const bs = new Date(bStart).getTime()
  const be = new Date(bEnd).getTime()
  return as < be && ae > bs
}

/**
 * The set of `officialId:slotStartISO` keys a day's declared periods cover.
 *
 * Returning a key set rather than asking the grid to scan the period list per
 * cell keeps the render O(cells) instead of O(cells × periods): the by-person
 * grid draws one cell per official per slot and would otherwise re-scan every
 * period for each. The key shape matches the grid's existing `assignmentMap`
 * and `doubleBookedOfficials` sets, so the lookup at the cell is the same
 * single `.has()` those already do.
 *
 * Slot ends are derived from `granularityMin` rather than read from an
 * assignment row, because the slot being tested usually has no assignment —
 * an empty cell is exactly where this overlay matters most.
 */
export function buildUnavailableSlotKeys(
  periods: UnavailabilityPeriod[],
  slots: Date[],
  granularityMin: number
): Set<string> {
  const keys = new Set<string>()
  const slotMs = granularityMin * 60 * 1000

  for (const slot of slots) {
    const slotStart = slot.getTime()
    const slotEnd = slotStart + slotMs
    const slotIso = slot.toISOString()

    for (const period of periods) {
      if (periodsOverlap(period.starts_at, period.ends_at, slotStart, slotEnd)) {
        keys.add(`${period.official_id}:${slotIso}`)
      }
    }
  }

  return keys
}

/**
 * The periods covering one official's slot, for the cell tooltip.
 *
 * Separate from the key set above because the two answer different questions
 * at different frequencies: every cell asks "is this covered" (cheap set
 * lookup), and only a hovered or assigned cell asks "by what, and why"
 * (this). Folding the reason into the key set would mean building every
 * tooltip string on every render to show at most a handful.
 */
export function periodsCoveringSlot(
  periods: UnavailabilityPeriod[],
  officialId: string,
  slotStart: Date,
  granularityMin: number
): UnavailabilityPeriod[] {
  const start = slotStart.getTime()
  const end = start + granularityMin * 60 * 1000

  return periods.filter(
    (p) => p.official_id === officialId && periodsOverlap(p.starts_at, p.ends_at, start, end)
  )
}

/**
 * Assignments that fall inside a declared period — the warning the admin grid
 * surfaces, and deliberately the only consequence of declaring one.
 *
 * Nothing in this feature blocks the assignment: this returns what to warn
 * about, and the caller renders it. That mirrors the capacity rule (over the
 * ceiling warns, outside an operating window blocks) and keeps event-day
 * override possible — an admin calling someone in when a colleague falls ill
 * must not be stopped by a three-week-old declaration.
 */
export function findUnavailableAssignments<
  T extends { official_id: string; timeslot_start: string; timeslot_end: string },
>(assignments: T[], periods: UnavailabilityPeriod[]): T[] {
  if (periods.length === 0) return []

  const byOfficial = new Map<string, UnavailabilityPeriod[]>()
  for (const period of periods) {
    const list = byOfficial.get(period.official_id) ?? []
    list.push(period)
    byOfficial.set(period.official_id, list)
  }

  return assignments.filter((a) => {
    const periodsForOfficial = byOfficial.get(a.official_id)
    if (!periodsForOfficial) return false
    return periodsForOfficial.some((p) =>
      periodsOverlap(p.starts_at, p.ends_at, a.timeslot_start, a.timeslot_end)
    )
  })
}

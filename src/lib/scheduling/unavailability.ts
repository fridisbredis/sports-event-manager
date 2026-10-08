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

/** Who recorded a period, and therefore who may edit it. */
export type UnavailabilityAuthor = 'official' | 'tenant_admin'

/** One declared period, as stored. */
export interface UnavailabilityPeriod {
  id: string
  official_id: string
  starts_at: string
  ends_at: string
  reason: string | null
  /**
   * Defaults to 'official' when absent so a caller that selects the narrower
   * column set still type-checks — the column itself is NOT NULL with that
   * same default, so this mirrors the database rather than inventing a value.
   */
  created_by_role?: UnavailabilityAuthor
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

/**
 * The periods covering each `officialId:slotStartISO`, keyed the same way
 * `buildUnavailableSlotKeys` keys its set.
 *
 * Returned alongside the plain key set rather than replacing it because the
 * two are read at different frequencies: every cell asks "is this covered"
 * (one `.has()`), and only a blocked or hovered cell asks "by whom, and why".
 * Building the map costs the same pass, so the grid can colour admin-set and
 * official-declared absences differently without a second scan.
 */
export function buildUnavailableSlotMap(
  periods: UnavailabilityPeriod[],
  slots: Date[],
  granularityMin: number
): Map<string, UnavailabilityPeriod[]> {
  const map = new Map<string, UnavailabilityPeriod[]>()
  const slotMs = granularityMin * 60 * 1000

  for (const slot of slots) {
    const slotStart = slot.getTime()
    const slotEnd = slotStart + slotMs
    const slotIso = slot.toISOString()

    for (const period of periods) {
      if (periodsOverlap(period.starts_at, period.ends_at, slotStart, slotEnd)) {
        const key = `${period.official_id}:${slotIso}`
        const list = map.get(key)
        if (list) list.push(period)
        else map.set(key, [period])
      }
    }
  }

  return map
}

/**
 * Which kind of absence to render for a cell when both kinds overlap it.
 *
 * An admin-recorded period wins the styling: it is the organisers' own note,
 * and on a grid the admin is looking at, "we marked this person off" is the
 * more actionable of the two. Both block the slot equally — this only decides
 * which hatch and which label the cell shows.
 */
export function dominantAuthor(periods: UnavailabilityPeriod[]): UnavailabilityAuthor {
  return periods.some((p) => p.created_by_role === 'tenant_admin') ? 'tenant_admin' : 'official'
}

/**
 * Collapses touching or overlapping periods into continuous spans.
 *
 * Painting a person's row in three separate drags stores three rows — which is
 * right, since each is its own statement an admin can withdraw — but rendering
 * them as three lines reads as three unrelated absences when the person is
 * simply away from 07:00 to 10:00. The shift list already merges contiguous
 * slots for exactly this reason (`mergeContiguousSlots`); this is its
 * counterpart for declared time off.
 *
 * Only periods with the SAME author and the SAME reason merge. Two absences an
 * admin recorded run together; an admin's and the official's own stay apart,
 * because who said it is part of what the line means.
 *
 * Input need not be sorted.
 */
export function mergeAdjacentPeriods(periods: UnavailabilityPeriod[]): UnavailabilityPeriod[] {
  if (periods.length < 2) return [...periods]

  const sorted = [...periods].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
  )

  const merged: UnavailabilityPeriod[] = []

  for (const period of sorted) {
    const last = merged[merged.length - 1]
    const mergeable =
      last !== undefined &&
      last.created_by_role === period.created_by_role &&
      (last.reason ?? null) === (period.reason ?? null) &&
      // Touching counts, not just overlapping: 07:00–08:00 and 08:00–09:00
      // describe one unbroken absence, and the half-open convention means they
      // do not "overlap" in the periodsOverlap sense.
      new Date(period.starts_at).getTime() <= new Date(last.ends_at).getTime()

    if (mergeable) {
      if (new Date(period.ends_at).getTime() > new Date(last.ends_at).getTime()) {
        last.ends_at = period.ends_at
      }
    } else {
      merged.push({ ...period })
    }
  }

  return merged
}

/**
 * Who declared the time off a span runs into, or null when it runs into none.
 *
 * The admin grid hard-blocks new assignments on a declared period, so this
 * cannot arise from scheduling someone fresh. It arises the other way round:
 * an official already holds a shift and then books the time off, or an admin
 * marks them away afterwards. That was a deliberate decision (Frida,
 * 2026-10-07) — existing assignments are never cleared, because the clash is
 * exactly the thing the two of them need to talk about, and silently dropping
 * the shift would hide it from both.
 *
 * Which means the official is the one person who can see both halves, and the
 * only one the app can tell. Hence this, on the shift card itself rather than
 * as a separate notice: the warning belongs where the contradiction is.
 *
 * `tenant_admin` wins a tie for the same reason it does in `dominantAuthor` —
 * "the organisers marked you off and then scheduled you anyway" is the more
 * surprising of the two statements, and the one worth naming.
 */
export function clashingAuthor(
  spanStart: Instant,
  spanEnd: Instant,
  periods: UnavailabilityPeriod[]
): UnavailabilityAuthor | null {
  const hits = periods.filter((p) => periodsOverlap(spanStart, spanEnd, p.starts_at, p.ends_at))
  return hits.length === 0 ? null : dominantAuthor(hits)
}

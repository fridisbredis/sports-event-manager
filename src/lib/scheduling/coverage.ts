import type { SupabaseClient } from '@supabase/supabase-js'
import { groupIntoWorkAreaRuns } from '@/lib/scheduling/day-window'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { logger } from '@/lib/logger'

/**
 * Guard-rails, not pagination — the same role and reasoning as OFF-01's
 * SHIFT_CEILING and MYSCH-01's SCHEDULE_CEILING. One day of one event, so
 * this is generous: a 24-hour event at 15-minute granularity with 20 work
 * areas and 3 people in each slot is under 6000, and anything past that is a
 * seeding accident worth seeing in the logs rather than silently truncating.
 */
const COVERAGE_CEILING = 2000

/** One `assignments` row for the day, joined to its work area and official. */
interface CoverageRow {
  timeslot_start: string
  timeslot_end: string
  workstation_id: string | null
  official_id: string | null
  officials: { id: string; name: string } | null
}

/** One person's unbroken run at one work area. */
export interface CoverageShift {
  officialId: string
  officialName: string
  start: string
  end: string
}

/** One work area's staffing for the day on screen. */
export interface WorkAreaCoverage {
  workstationId: string
  name: string
  color: string | null
  /** Ascending by start, then by name — see fetchDayCoverage. */
  shifts: CoverageShift[]
}

/**
 * Who is working where, for one day of one event — the read-only counterpart
 * to SCHED-01's editable grid (N18).
 *
 * Shifts, not slots. One `assignments` row is one grid slot, so three
 * back-to-back hours at one place is one shift here, folded with
 * `groupIntoWorkAreaRuns` — the same helper MYSCH-01 groups by, OFF-01's
 * expanded row folds with, and `countShifts` counts through. That agreement
 * is the point: B5 was these screens disagreeing about what a shift is.
 *
 * Grouped per work area rather than per person, because the question this
 * screen answers on site is "is the finish line covered at 14:00", not "what
 * is Anna doing". Work areas with nobody assigned are included deliberately —
 * an empty work area is the most important thing this view can show, and
 * leaving it out would make a gap in coverage invisible.
 *
 * The assignment filters mirror OFF-01's and MYSCH-01's: tenant-scoped,
 * 'assigned' only, and work-area-bearing only.
 *
 * Never throws, for the same reason `fetchOfficialDetail` does not: a failed
 * read returns empty coverage and logs (F-REL-10). Note what that means here
 * — "nobody is assigned" and "the read failed" render identically, and on a
 * screen whose entire job is spotting unstaffed work areas, that is a false
 * reassurance rather than a missing detail. So the caller is told which it
 * was, via `ok`, and says so on screen.
 */
export interface DayCoverage {
  areas: WorkAreaCoverage[]
  /**
   * False when the assignment read failed. The areas are then listed with no
   * shifts, which is indistinguishable from a genuinely empty day — the view
   * must say so rather than imply an empty schedule.
   */
  ok: boolean
}

export async function fetchDayCoverage(
  supabase: SupabaseClient,
  {
    tenantId,
    day,
    workstations,
  }: {
    tenantId: string
    /** UTC calendar day, `YYYY-MM-DD`. */
    day: string
    /** The day's work areas, already read and ordered by the page. */
    workstations: { id: string; name: string; color: string | null }[]
  }
): Promise<DayCoverage> {
  const dayStart = new Date(`${day}T00:00:00.000Z`)
  const dayEnd = new Date(dayStart)
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

  // Scoped to the day on screen, exactly as SCHED-01's own fetch is: a tenant
  // running many events accumulates far more assignments than one view should
  // ever pull, and the grid only shows one day at a time either way.
  const { data, error } = await supabase
    .from('assignments')
    .select('timeslot_start, timeslot_end, workstation_id, official_id, officials ( id, name )')
    .eq('tenant_id', tenantId)
    .eq('status', 'assigned')
    .not('workstation_id', 'is', null)
    .gte('timeslot_start', dayStart.toISOString())
    .lt('timeslot_start', dayEnd.toISOString())
    // Ascending by official then time, which is what the per-person grouping
    // below requires: `groupIntoWorkAreaRuns` folds consecutive slots, so two
    // people's slots must not interleave within one work area's list.
    .order('official_id')
    .order('timeslot_start')

  if (error) {
    logger.error('N18: day coverage failed to load', error, { tenantId, day })
    return { areas: emptyAreas(workstations), ok: false }
  }

  const bounded = checkReadCeiling((data ?? []) as unknown as CoverageRow[], {
    ceiling: COVERAGE_CEILING,
    page: 'admin/scheduling#coverage',
    message: 'Mobile schedule hit its read ceiling — coverage is truncated',
    context: { tenantId, day },
  })

  const byArea = new Map<string, CoverageRow[]>()
  for (const row of bounded) {
    if (!row.workstation_id) continue
    const rows = byArea.get(row.workstation_id)
    if (rows) rows.push(row)
    else byArea.set(row.workstation_id, [row])
  }

  const areas = workstations.map((ws) => ({
    workstationId: ws.id,
    name: ws.name,
    color: ws.color,
    shifts: foldShifts(byArea.get(ws.id) ?? []),
  }))

  return { areas, ok: true }
}

/**
 * One work area's rows folded into per-person shifts.
 *
 * Grouped by official first: `groupIntoWorkAreaRuns` joins slots that touch,
 * and within a single work area every slot shares the same work-area id — so
 * feeding it two people's slots unsorted would fold Anna's 09:00-10:00 and
 * Bo's 10:00-11:00 into one run and claim a single unbroken shift worked by
 * whoever happened to come first.
 */
function foldShifts(rows: CoverageRow[]): CoverageShift[] {
  const byOfficial = new Map<string, CoverageRow[]>()
  for (const row of rows) {
    if (!row.official_id) continue
    const existing = byOfficial.get(row.official_id)
    if (existing) existing.push(row)
    else byOfficial.set(row.official_id, [row])
  }

  const shifts: CoverageShift[] = []
  for (const [officialId, officialRows] of byOfficial) {
    // Every slot here shares one work area, so the run key is constant and
    // the helper breaks on time alone — which is what is wanted: a morning
    // and an afternoon stint at the same place stay two shifts.
    for (const run of groupIntoWorkAreaRuns(officialRows, () => null)) {
      shifts.push({
        officialId,
        // Null only where the join came back empty, which cannot happen for a
        // row whose official_id is set — rendered as a dash rather than
        // crashing the view.
        officialName: run.slots[0]?.officials?.name ?? '—',
        start: run.span.start,
        end: run.span.end,
      })
    }
  }

  // Earliest first, then by name: reading down a work area should follow the
  // day, and two people starting together should not swap places between
  // renders the way Map insertion order would.
  return shifts.sort(
    (a, b) =>
      new Date(a.start).getTime() - new Date(b.start).getTime() ||
      a.officialName.localeCompare(b.officialName)
  )
}

function emptyAreas(
  workstations: { id: string; name: string; color: string | null }[]
): WorkAreaCoverage[] {
  return workstations.map((ws) => ({
    workstationId: ws.id,
    name: ws.name,
    color: ws.color,
    shifts: [],
  }))
}

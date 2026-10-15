import type { SupabaseClient } from '@supabase/supabase-js'
import { groupIntoWorkAreaRuns } from '@/lib/scheduling/day-window'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { logger } from '@/lib/logger'

/**
 * Guard-rails, not pagination — the same role and reasoning as MYSCH-01's
 * SCHEDULE_CEILING and countOfficialShifts' SHIFT_COUNT_CEILING, which bound
 * the identical sets of rows. Asking for one row past each makes a breach
 * visible in the logs instead of silently shortening what OFF-01 shows.
 */
const SHIFT_CEILING = 500
const TIME_OFF_CEILING = 200

/** One `assignments` row, joined to the work area it belongs to. */
interface AssignmentRow {
  timeslot_start: string
  timeslot_end: string
  workstation_id: string | null
  workstations: { id: string; name: string } | null
}

/** A shift as OFF-01 renders it: one run of back-to-back slots at one place. */
export interface OfficialShift {
  start: string
  end: string
  workAreaName: string | null
}

/** One declared or admin-recorded absence. */
export interface OfficialTimeOff {
  id: string
  startsAt: string
  endsAt: string
  reason: string | null
  /** Who put it there — an official's own declaration, or an admin's record. */
  createdByRole: string
}

export interface OfficialDetail {
  shifts: OfficialShift[]
  timeOff: OfficialTimeOff[]
}

/**
 * Everything OFF-01's expanded row shows about one official beyond the
 * columns already on the row.
 *
 * Shifts, not slots. One `assignments` row is one grid slot, so an official
 * working 11:00-14:00 at a 1h granularity has three rows and one shift. This
 * folds them with `groupIntoWorkAreaRuns`, the same helper MYSCH-01 groups by
 * and that `countOfficialShifts` counts through — so the roster, the account
 * screen and the official's own schedule all agree on what a shift is. B5 was
 * exactly this disagreement.
 *
 * The assignment filters mirror MYSCH-01's day-list query: tenant-scoped (an
 * official re-invited into a second tenant has rows in both), 'assigned' only,
 * and work-area-bearing only.
 *
 * Time off is read whole rather than per day: this is a roster summary, and an
 * absence running across several days should read as one period here, which is
 * how it is stored.
 *
 * Never throws. This fills a disclosure under a row whose primary job is the
 * roster itself; failing the whole screen over it would be the worse trade. A
 * failed read logs (F-REL-10) and returns an empty list, which the rendered
 * "no shifts" and "no time off" wording already covers. Note that this means
 * an empty list is not proof of an empty schedule — the caller renders the
 * same copy either way, so the admin is never shown a wrong number, only a
 * less informative one.
 */
export async function fetchOfficialDetail(
  supabase: SupabaseClient,
  { tenantId, officialId }: { tenantId: string; officialId: string }
): Promise<OfficialDetail> {
  const [shifts, timeOff] = await Promise.all([
    fetchShifts(supabase, tenantId, officialId),
    fetchTimeOff(supabase, tenantId, officialId),
  ])

  return { shifts, timeOff }
}

async function fetchShifts(
  supabase: SupabaseClient,
  tenantId: string,
  officialId: string
): Promise<OfficialShift[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('timeslot_start, timeslot_end, workstation_id, workstations ( id, name )')
    .eq('official_id', officialId)
    .eq('tenant_id', tenantId)
    .eq('status', 'assigned')
    .not('workstation_id', 'is', null)
    .order('timeslot_start')
    .range(0, SHIFT_CEILING)

  if (error) {
    logger.error('OFF-01: official shifts failed to load', error, { tenantId, officialId })
    return []
  }

  const bounded = checkReadCeiling((data ?? []) as unknown as AssignmentRow[], {
    ceiling: SHIFT_CEILING,
    page: 'admin/officials#detail',
    message: 'Official detail hit its shift read ceiling — the list is truncated',
    context: { tenantId, officialId },
  })

  // Ascending by start, which `groupIntoWorkAreaRuns` requires; the query
  // above orders it.
  return groupIntoWorkAreaRuns(bounded, (slot) => slot.workstation_id).map((run) => ({
    start: run.span.start,
    end: run.span.end,
    // Every slot in a run shares one work area, so the first slot names it.
    // Null only where the join came back empty, which the filter above
    // already excludes — rendered as a dash rather than crashing the row.
    workAreaName: run.slots[0]?.workstations?.name ?? null,
  }))
}

async function fetchTimeOff(
  supabase: SupabaseClient,
  tenantId: string,
  officialId: string
): Promise<OfficialTimeOff[]> {
  const { data, error } = await supabase
    .from('official_unavailability')
    .select('id, starts_at, ends_at, reason, created_by_role')
    .eq('official_id', officialId)
    .eq('tenant_id', tenantId)
    .order('starts_at')
    .range(0, TIME_OFF_CEILING)

  if (error) {
    logger.error('OFF-01: official time off failed to load', error, { tenantId, officialId })
    return []
  }

  const bounded = checkReadCeiling(
    (data ?? []) as {
      id: string
      starts_at: string
      ends_at: string
      reason: string | null
      created_by_role: string
    }[],
    {
      ceiling: TIME_OFF_CEILING,
      page: 'admin/officials#detail',
      message: 'Official detail hit its time-off read ceiling — the list is truncated',
      context: { tenantId, officialId },
    }
  )

  return bounded.map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
    createdByRole: row.created_by_role,
  }))
}

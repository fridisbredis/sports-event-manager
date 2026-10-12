import type { SupabaseClient } from '@supabase/supabase-js'
import { countShifts } from '@/lib/scheduling/day-window'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { logger } from '@/lib/logger'

/**
 * A guard-rail, not pagination — the same role and the same reasoning as
 * MYSCH-01's SCHEDULE_CEILING, which bounds the identical set of rows. Asking
 * for one row past it makes a breach visible in the logs instead of silently
 * understating someone's shift count.
 */
const SHIFT_COUNT_CEILING = 500

/** The slot shape `countShifts` folds — one `assignments` row. */
interface AssignmentSlot {
  timeslot_start: string
  timeslot_end: string
  workstation_id: string | null
}

/**
 * How many shifts one official works in one tenant.
 *
 * Shifts, not slots. One `assignments` row is one grid slot, so the head
 * count ACCT-01 used to show reported an official working 11:00-14:00 at a
 * 1h granularity as "3" while MYSCH-01 — which collapses a run of back-to-back
 * slots at one work area into a single card — showed one. This reads the rows
 * and folds them with the same helper that screen groups by, so the two
 * numbers agree.
 *
 * The filters mirror MYSCH-01's day-list query: tenant-scoped (an official
 * re-invited into a second tenant has rows in both), 'assigned' only, and
 * work-area-bearing only — the head count carried none of those and inflated
 * the number further.
 *
 * Never throws. This is a summary line above a link to the schedule itself,
 * and failing the whole account screen over it would be the worse trade — a
 * failed read logs (F-REL-10) and returns 0, which the "no shifts yet"
 * wording already covers.
 */
export async function countOfficialShifts(
  supabase: SupabaseClient,
  { tenantId, officialId }: { tenantId: string; officialId: string }
): Promise<number> {
  const { data, error } = await supabase
    .from('assignments')
    .select('timeslot_start, timeslot_end, workstation_id')
    .eq('official_id', officialId)
    .eq('tenant_id', tenantId)
    .eq('status', 'assigned')
    .not('workstation_id', 'is', null)
    .order('timeslot_start')
    .range(0, SHIFT_COUNT_CEILING)

  if (error) {
    logger.error('Account: shift count failed to load', error, { tenantId, officialId })
    return 0
  }

  const bounded = checkReadCeiling((data ?? []) as AssignmentSlot[], {
    ceiling: SHIFT_COUNT_CEILING,
    page: 'account#shiftCount',
    message: 'Account shift count hit its read ceiling — the count is understated',
    context: { tenantId, officialId },
  })

  return countShifts(bounded, (slot) => slot.workstation_id)
}

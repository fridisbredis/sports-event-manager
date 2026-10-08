'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import type { Json } from '@/types/database'
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from '@/types/app'
import { adminDashboardCacheTag } from '@/lib/cache/tags'
import { translateActionError as tError } from '@/lib/actions/action-error'

const tenantIdSchema = z.string().uuid()

// Batch ceilings. save_assignments_batch (migration 0033) is the authority —
// it enforces the same numbers itself, because it is granted to
// `authenticated` and can therefore be called directly, bypassing this whole
// module. These exist so the real client gets "that save is too large" from
// the Server Action instead of a round trip that ends in a generic RPC error.
// Keep in sync with c_max_additions / c_max_deletions / c_max_status_updates
// in 0033; the asymmetry is deliberate and its derivation is documented there.
const MAX_ADDITIONS = 500
const MAX_DELETIONS = 5000
const MAX_STATUS_UPDATES = 500

// saveAssignments is a Server Action — a public HTTP endpoint whose array
// arguments are entirely client-controlled — so the payload gets the same
// treatment as tenantId. Two concrete reasons this is not cosmetic:
//   - a null workstation_id/timeslot would otherwise reach
//     save_assignments_batch (migration 0033) and build a null occupancy key
//   - assignments.official_id references officials(id) with no
//     tenant-consistency constraint (0001_initial_schema.sql:66), so an
//     unvalidated official_id can write a row into this tenant pointing at
//     another tenant's official
//   - assignments.workstation_id has the same gap, and the unique constraint
//     that guards slots (migration 0012) has no tenant_id column — so a
//     foreign workstation_id lets one tenant occupy another tenant's slot.
//     Migration 0033 rejects both; these schemas are the first line, not the
//     only one, since the RPC is callable without going through this action.
// `datetime({ offset: true })` rather than the Z-only default: the grid sends
// Date.toISOString() today, but a DB-derived timestamptz arrives as +00:00 and
// must not be rejected by the validator.
const additionSchema = z.object({
  official_id: z.string().uuid(),
  workstation_id: z.string().uuid(),
  timeslot_start: z.string().datetime({ offset: true }),
  timeslot_end: z.string().datetime({ offset: true }),
  // 1-based — the grid builds slots as
  // Array.from({ length: capacity_ceiling }, (_, i) => i + 1).
  slot_index: z.number().int().positive().optional(),
})

const additionsSchema = z.array(additionSchema).max(MAX_ADDITIONS)

const deletionsSchema = z.array(z.string().uuid()).max(MAX_DELETIONS)

// Derived from ASSIGNMENT_STATUSES (src/types/app.ts), which is itself the
// single list matching the assignments status CHECK
// (0003_phase6_schema.sql:244) — not a second hardcoded copy of those values.
const statusUpdatesSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      status: z.enum(ASSIGNMENT_STATUSES),
    })
  )
  .max(MAX_STATUS_UPDATES)

export interface AssignmentInput {
  official_id: string
  workstation_id: string
  timeslot_start: string
  timeslot_end: string
  slot_index?: number
}

export interface StatusUpdate {
  id: string
  status: AssignmentStatus
}

export interface SaveAssignmentsResult {
  error?: string
  inserted?: {
    id: string
    official_id: string
    workstation_id: string | null
    timeslot_start: string
    slot_index: number | null
  }[]
}

// User-facing strings — kept as named constants so the RPC error-code
// mapping below and the (rare) direct early-return above stay in sync.
const NOT_AUTHORIZED_KEY = 'actionErrors.notAuthorized'
const SLOT_TAKEN_KEY = 'actionErrors.slotTaken'
const INVALID_REQUEST_KEY = 'actionErrors.invalidRequest'
// Deliberately distinct from INVALID_REQUEST_KEY: this save is well-formed,
// just too big, and the fix is "split it up" rather than "the caller is
// broken". Collapsing the two costs whoever debugs it real time.
const BATCH_TOO_LARGE_KEY = 'actionErrors.batchTooLarge'

// Custom errcodes raised by save_assignments_batch
// (supabase/migrations/0033_save_assignments_batch_rpc.sql). Mapping on the
// errcode rather than the raw Postgres error message keeps this decoupled
// from whatever text/wrapping Postgres or PostgREST puts around it.
const SLOT_TAKEN_ERRCODE = 'ASG01'
const NOT_AUTHORIZED_ERRCODE = 'ASG02'
const INVALID_PAYLOAD_ERRCODE = 'ASG03'
const BATCH_TOO_LARGE_ERRCODE = 'ASG04'

export async function saveAssignments(
  tenantSlug: string,
  tenantId: string,
  additions: AssignmentInput[],
  deletions: string[],
  statusUpdates: StatusUpdate[] = []
): Promise<SaveAssignmentsResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(tenantId)
  if (!parsedTenantId.success) {
    logger.warn('saveAssignments: invalid tenantId', { tenantId })
    return { error: await tError(NOT_AUTHORIZED_KEY) }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: await tError(NOT_AUTHORIZED_KEY) }

  // Checked before the zod parse, not left to the schemas' own .max(). Both
  // layers reject the same payloads, but a bare safeParse failure cannot say
  // WHICH rule was broken, so an over-cap-but-valid save would come back as
  // "Invalid request" — the same message a malformed payload gets. Splitting
  // it here keeps "too big, split it up" distinguishable from "your caller is
  // broken", matching the ASG04-vs-ASG03 split in migration 0033.
  // Array.isArray rather than a bare .length: these are declared as arrays but
  // this is a Server Action, so a caller can hand us null or a scalar. Reading
  // .length off that would throw here, where the safeParse below handles it
  // and returns a clean INVALID_REQUEST_KEY.
  if (
    (Array.isArray(additions) && additions.length > MAX_ADDITIONS) ||
    (Array.isArray(deletions) && deletions.length > MAX_DELETIONS) ||
    (Array.isArray(statusUpdates) && statusUpdates.length > MAX_STATUS_UPDATES)
  ) {
    logger.warn('saveAssignments: batch over cap', {
      tenantId,
      additions: Array.isArray(additions) ? additions.length : null,
      deletions: Array.isArray(deletions) ? deletions.length : null,
      statusUpdates: Array.isArray(statusUpdates) ? statusUpdates.length : null,
    })
    return { error: await tError(BATCH_TOO_LARGE_KEY) }
  }

  const parsedAdditions = additionsSchema.safeParse(additions)
  const parsedDeletions = deletionsSchema.safeParse(deletions)
  const parsedStatusUpdates = statusUpdatesSchema.safeParse(statusUpdates)

  if (!parsedAdditions.success || !parsedDeletions.success || !parsedStatusUpdates.success) {
    // Log which array failed, never the zod issues themselves — those echo
    // the rejected input back to the caller.
    logger.warn('saveAssignments: invalid payload', {
      tenantId,
      additions: !parsedAdditions.success,
      deletions: !parsedDeletions.success,
      statusUpdates: !parsedStatusUpdates.success,
    })
    return { error: await tError(INVALID_REQUEST_KEY) }
  }

  // TIME-OFF BLOCK (Peter, 2026-10-07). No NEW assignment may land on a period
  // marked as time off, whether the official declared it or an admin recorded
  // it. Checked here rather than in a DB constraint deliberately: rows that
  // already sit on a declared period must survive — time off is often recorded
  // after the shift was assigned — and a constraint would then refuse every
  // later write to such a row, including the admin's attempt to delete it.
  //
  // Enforced in the Server Action and not only in the grid because the grid is
  // not the security boundary: this action is a public HTTP endpoint, and a
  // UI-only block is cosmetic. Deletions and status updates are deliberately
  // NOT checked — removing or re-statusing an existing overlap is exactly how
  // an admin cleans one up.
  if (parsedAdditions.data.length > 0) {
    const officialIds = [...new Set(parsedAdditions.data.map((a) => a.official_id))]
    // Normalised before comparing, for the same reason the overlap test below
    // is: the batch can legitimately carry both timestamp shapes, and picking
    // the window by string would then clip it to the wrong bounds.
    const startMs = parsedAdditions.data.map((a) => new Date(a.timeslot_start).getTime())
    const endMs = parsedAdditions.data.map((a) => new Date(a.timeslot_end).getTime())
    const windowStart = new Date(Math.min(...startMs)).toISOString()
    const windowEnd = new Date(Math.max(...endMs)).toISOString()

    // One query for the whole batch rather than one per addition: a paint-drag
    // sends hundreds of rows, and the window is bounded by the batch itself.
    const { data: periods, error: periodsError } = await supabase
      .from('official_unavailability')
      .select('official_id, starts_at, ends_at')
      .eq('tenant_id', parsedTenantId.data)
      .in('official_id', officialIds)
      .lt('starts_at', windowEnd)
      .gt('ends_at', windowStart)

    // Fail closed. Everywhere else in this codebase a failed read degrades to
    // "show less" (F-REL-10), but this read is a guard: treating an unknown
    // answer as "no time off" would let the save through precisely when the
    // check is broken, which is the opposite of what a block is for.
    if (periodsError) {
      logger.error('saveAssignments: time-off check failed', periodsError, {
        tenantId,
        officials: officialIds.length,
      })
      return { error: await tError('actionErrors.saveAssignmentsFailed') }
    }

    // Compared as instants, never as strings. PostgREST returns a timestamptz
    // as `...T09:00:00+00:00` while the grid sends `Date.toISOString()`
    // (`...T09:00:00.000Z`) — the same moment, but lexically `+` sorts below
    // `.`, so a string comparison silently gets overlaps wrong. The same
    // reasoning mergeContiguousSlots already documents.
    //
    // Half-open on both sides, matching periodsOverlap and the DB's own CHECK:
    // a shift starting exactly when an absence ends is adjacent, not in
    // conflict.
    const periodInstants = (periods ?? []).map((p) => ({
      official_id: p.official_id,
      starts: new Date(p.starts_at).getTime(),
      ends: new Date(p.ends_at).getTime(),
    }))

    const blocked = parsedAdditions.data.some((addition) => {
      const start = new Date(addition.timeslot_start).getTime()
      const end = new Date(addition.timeslot_end).getTime()
      return periodInstants.some(
        (p) => p.official_id === addition.official_id && start < p.ends && end > p.starts
      )
    })

    if (blocked) {
      logger.warn('saveAssignments: rejected additions overlapping declared time off', {
        tenantId,
        additions: parsedAdditions.data.length,
      })
      return { error: await tError('actionErrors.assignmentOnTimeOff') }
    }
  }

  // Runs the delete/status-update/occupancy-check/insert batch as one DB
  // transaction (PERF-02) — see migration 0033 for the exact semantics
  // preserved from the old sequential-calls version (re-read timing,
  // overflow allowance, slot-collision handling).
  const { data, error } = await supabase
    .rpc('save_assignments_batch', {
      p_tenant_id: parsedTenantId.data,
      p_deletions: parsedDeletions.data,
      // StatusUpdate[]/AssignmentInput[] are plain JSON-serializable data
      // (strings/numbers only) — cast through unknown to satisfy the
      // generated Json arg type, not a type-safety bypass.
      p_status_updates: parsedStatusUpdates.data as unknown as Json,
      p_additions: parsedAdditions.data as unknown as Json,
    })
    .select('id, official_id, workstation_id, timeslot_start, slot_index')

  if (error) {
    if (error.code === SLOT_TAKEN_ERRCODE) return { error: await tError(SLOT_TAKEN_KEY) }
    if (error.code === NOT_AUTHORIZED_ERRCODE) return { error: await tError(NOT_AUTHORIZED_KEY) }
    // The RPC rejected an addition missing official_id/workstation_id/either
    // timeslot bound. The zod parse above should already have caught this, so
    // reaching here means a non-app caller — log it, return nothing specific.
    if (error.code === INVALID_PAYLOAD_ERRCODE) {
      logger.warn('saveAssignments: RPC rejected an invalid assignment payload', { tenantId })
      return { error: await tError(INVALID_REQUEST_KEY) }
    }
    // Unreachable via this action — the cap check above already returned. Kept
    // because 0033 is granted to `authenticated` and enforces its own caps, so
    // this code is part of the RPC's contract regardless of who calls it.
    if (error.code === BATCH_TOO_LARGE_ERRCODE) {
      logger.warn('saveAssignments: RPC rejected an over-cap batch', { tenantId })
      return { error: await tError(BATCH_TOO_LARGE_KEY) }
    }

    logger.error('saveAssignments: save_assignments_batch RPC failed', error, { tenantId })
    return { error: await tError('actionErrors.saveAssignmentsFailed') }
  }

  revalidatePath(`/${tenantSlug}/admin/scheduling`)

  // PERF-06 / F-PERF-04 Phase 3: the dashboard's cached summary reads
  // assignments transitively via scheduling_warning_counts (over-capacity /
  // double-booking counts). updateTag (not revalidateTag) so the admin who
  // just saved sees the warnings update immediately.
  updateTag(adminDashboardCacheTag(parsedTenantId.data))

  return { inserted: data ?? [] }
}

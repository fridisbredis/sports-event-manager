'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import type { Json } from '@/types/database'
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from '@/types/app'

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
const NOT_AUTHORIZED_ERROR = 'Not authorized'
const SLOT_TAKEN_ERROR =
  'Someone else just took that slot. Please reload the schedule and try again.'
const INVALID_REQUEST_ERROR = 'Invalid request'
// Deliberately distinct from INVALID_REQUEST_ERROR: this save is well-formed,
// just too big, and the fix is "split it up" rather than "the caller is
// broken". Collapsing the two costs whoever debugs it real time.
const BATCH_TOO_LARGE_ERROR =
  'Too many assignments in one save. Split the change into smaller saves.'

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
    return { error: NOT_AUTHORIZED_ERROR }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: NOT_AUTHORIZED_ERROR }

  // Checked before the zod parse, not left to the schemas' own .max(). Both
  // layers reject the same payloads, but a bare safeParse failure cannot say
  // WHICH rule was broken, so an over-cap-but-valid save would come back as
  // "Invalid request" — the same message a malformed payload gets. Splitting
  // it here keeps "too big, split it up" distinguishable from "your caller is
  // broken", matching the ASG04-vs-ASG03 split in migration 0033.
  // Array.isArray rather than a bare .length: these are declared as arrays but
  // this is a Server Action, so a caller can hand us null or a scalar. Reading
  // .length off that would throw here, where the safeParse below handles it
  // and returns a clean INVALID_REQUEST_ERROR.
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
    return { error: BATCH_TOO_LARGE_ERROR }
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
    return { error: INVALID_REQUEST_ERROR }
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
    if (error.code === SLOT_TAKEN_ERRCODE) return { error: SLOT_TAKEN_ERROR }
    if (error.code === NOT_AUTHORIZED_ERRCODE) return { error: NOT_AUTHORIZED_ERROR }
    // The RPC rejected an addition missing official_id/workstation_id/either
    // timeslot bound. The zod parse above should already have caught this, so
    // reaching here means a non-app caller — log it, return nothing specific.
    if (error.code === INVALID_PAYLOAD_ERRCODE) {
      logger.warn('saveAssignments: RPC rejected an invalid assignment payload', { tenantId })
      return { error: INVALID_REQUEST_ERROR }
    }
    // Unreachable via this action — the cap check above already returned. Kept
    // because 0033 is granted to `authenticated` and enforces its own caps, so
    // this code is part of the RPC's contract regardless of who calls it.
    if (error.code === BATCH_TOO_LARGE_ERRCODE) {
      logger.warn('saveAssignments: RPC rejected an over-cap batch', { tenantId })
      return { error: BATCH_TOO_LARGE_ERROR }
    }

    logger.error('saveAssignments: save_assignments_batch RPC failed', error, { tenantId })
    return { error: 'Failed to save assignments. Please try again.' }
  }

  revalidatePath(`/${tenantSlug}/admin/scheduling`)

  return { inserted: data ?? [] }
}

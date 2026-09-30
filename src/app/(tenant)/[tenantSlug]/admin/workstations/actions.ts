'use server'

import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { translateDbError } from '@/lib/actions/db-error-message'
import { workstationsCacheTag, adminDashboardCacheTag } from '@/lib/cache/tags'
import type { Json } from '@/types/database'
import type { ChecklistItemType } from '@/types/app'
import { WORK_AREA_COLORS } from '@/lib/theme/work-area-colors'

// The payload shape both workstation RPCs now take (migration
// 20260930085253). Previously create_ took {instruction_text, position}
// objects while update_ took bare strings; both take this now.
export interface TodoInput {
  instruction_text: string
  item_type: ChecklistItemType
}

// Trim, drop blanks, and keep array order — position is derived from
// ordinality inside the RPC, so it is deliberately not sent.
function normaliseTodos(todos: TodoInput[]): TodoInput[] {
  return todos
    .map((t) => ({ instruction_text: t.instruction_text.trim(), item_type: t.item_type }))
    .filter((t) => t.instruction_text.length > 0)
}

const tenantIdSchema = z.string().uuid()

// The column has a CHECK constraint on the same list, so an invalid name would
// be rejected by the database anyway — but as a 23514 the admin sees as a
// generic save failure. Validating here turns it into a no-op instead: a name
// the palette does not know is treated as "no colour chosen", which is what an
// unrecognised stored value already means everywhere on the read side.
const paletteNameSchema = z.enum(WORK_AREA_COLORS.map((c) => c.name) as [string, ...string[]])

function normaliseColor(color: string | null | undefined): string | null {
  const parsed = paletteNameSchema.safeParse(color)
  return parsed.success ? parsed.data : null
}

export interface WindowInput {
  window_start: string
  window_end: string
}

export interface CreateWorkstationInput {
  tenantSlug: string
  tenantId: string
  eventId: string
  stageId: string | null
  name: string
  description: string
  capacity: number
  recurring: boolean
  /** Palette name from WORK_AREA_COLORS; null leaves the work area uncoloured. */
  color: string | null
  windows: WindowInput[]
  todos: TodoInput[]
  schedulingGranularityMin: number
}

function findWindowShorterThanGranularity(
  windows: WindowInput[],
  schedulingGranularityMin: number
): boolean {
  return windows.some((w) => {
    const durationMin =
      (new Date(w.window_end).getTime() - new Date(w.window_start).getTime()) / 60_000
    return durationMin < schedulingGranularityMin
  })
}

export interface CreateWorkstationResult {
  error?: string
}

export async function createWorkstation(
  input: CreateWorkstationInput
): Promise<CreateWorkstationResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(input.tenantId)
  if (!parsedTenantId.success) {
    logger.warn('createWorkstation: invalid tenantId', { tenantId: input.tenantId })
    return { error: 'Not authorized' }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: 'Not authorized' }

  const validWindows = input.windows.filter((w) => w.window_start && w.window_end)
  if (findWindowShorterThanGranularity(validWindows, input.schedulingGranularityMin)) {
    return { error: 'Operating window is shorter than the scheduling granularity' }
  }

  const validTodos = normaliseTodos(input.todos)

  const { error: rpcError } = await supabase.rpc('create_workstation', {
    p_tenant_id: parsedTenantId.data,
    p_event_id: input.eventId,
    p_stage_id: input.stageId ?? undefined,
    p_name: input.name.trim(),
    p_description: input.description.trim() || undefined,
    p_capacity_ceiling: input.capacity,
    p_recurring: input.recurring,
    p_color: normaliseColor(input.color) ?? undefined,
    p_windows: validWindows as unknown as Json,
    p_todos: validTodos as unknown as Json,
  })

  if (rpcError)
    return {
      error: await translateDbError(
        'createWorkstation: create_workstation failed',
        rpcError,
        'workstations.genericSaveError'
      ),
    }

  revalidatePath(`/${input.tenantSlug}/admin/workstations`)
  // updateTag (not revalidateTag) so the admin who just created this
  // workstation sees it immediately on next render.
  updateTag(workstationsCacheTag(parsedTenantId.data))
  // PERF-06 / F-PERF-04 Phase 3: the dashboard's cached over_capacity/
  // double_booked warnings are computed via scheduling_warning_counts, which
  // joins against workstations.capacity_ceiling.
  updateTag(adminDashboardCacheTag(parsedTenantId.data))

  return {}
}

export interface UpdateWorkstationInput {
  tenantSlug: string
  tenantId: string
  workstationId: string
  stageId: string | null
  name: string
  description: string
  capacity: number
  recurring: boolean
  /** Palette name from WORK_AREA_COLORS; null clears the work area's colour. */
  color: string | null
  windows: WindowInput[]
  todos: TodoInput[]
  schedulingGranularityMin: number
}

export interface UpdateWorkstationResult {
  error?: string
}

export async function updateWorkstation(
  input: UpdateWorkstationInput
): Promise<UpdateWorkstationResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(input.tenantId)
  if (!parsedTenantId.success) {
    logger.warn('updateWorkstation: invalid tenantId', { tenantId: input.tenantId })
    return { error: 'Not authorized' }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: 'Not authorized' }

  const validWindows = input.windows.filter((w) => w.window_start && w.window_end)
  if (findWindowShorterThanGranularity(validWindows, input.schedulingGranularityMin)) {
    return { error: 'Operating window is shorter than the scheduling granularity' }
  }

  const validTodos = normaliseTodos(input.todos)

  // REL-01: workstation + operating windows + todos are updated atomically
  // by this RPC — see migration 20260908130927 and
  // docs/patterns/atomic-multi-table-writes.md. Previously these were five
  // separate operations (update, delete windows, insert windows, delete
  // todos, insert todos) with no transaction, so a failure on a later step
  // could leave the windows/todos deleted with no replacement.
  const { error: rpcError } = await supabase.rpc('update_workstation', {
    p_workstation_id: input.workstationId,
    p_tenant_id: parsedTenantId.data,
    p_stage_id: input.stageId ?? undefined,
    p_name: input.name.trim(),
    p_description: input.description.trim() || undefined,
    p_capacity_ceiling: input.capacity,
    p_recurring: input.recurring,
    // p_set_color is what makes "clear the colour" expressible at all: the
    // generated Args type has p_color as optional-string (never null), so a
    // cleared colour is sent by OMITTING p_color, which the function defaults
    // to null — indistinguishable, on its own, from "don't touch it". The
    // flag separates the two, and this form always has an opinion (it carries
    // the current colour), so it always sets.
    p_color: normaliseColor(input.color) ?? undefined,
    p_set_color: true,
    p_windows: validWindows as unknown as Json,
    p_todos: validTodos as unknown as Json,
  })

  if (rpcError)
    return {
      error: await translateDbError(
        'updateWorkstation: update_workstation failed',
        rpcError,
        'workstations.genericSaveError'
      ),
    }

  revalidatePath(`/${input.tenantSlug}/admin/workstations`)
  // updateTag (not revalidateTag) so the admin who just updated this
  // workstation sees the change immediately on next render.
  updateTag(workstationsCacheTag(parsedTenantId.data))
  // PERF-06 / F-PERF-04 Phase 3: capacity_ceiling feeds the dashboard's
  // cached over_capacity/double_booked warnings via scheduling_warning_counts.
  updateTag(adminDashboardCacheTag(parsedTenantId.data))

  return {}
}

export interface DeleteWorkstationInput {
  tenantSlug: string
  tenantId: string
  workstationId: string
}

export interface DeleteWorkstationResult {
  error?: string
}

export async function deleteWorkstation(
  input: DeleteWorkstationInput
): Promise<DeleteWorkstationResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(input.tenantId)
  if (!parsedTenantId.success) {
    logger.warn('deleteWorkstation: invalid tenantId', { tenantId: input.tenantId })
    return { error: 'Not authorized' }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: 'Not authorized' }

  const { error } = await supabase
    .from('workstations')
    .delete()
    .eq('id', input.workstationId)
    .eq('tenant_id', parsedTenantId.data)

  if (error)
    return {
      error: await translateDbError(
        'deleteWorkstation: delete failed',
        error,
        'workstations.genericDeleteError'
      ),
    }

  revalidatePath(`/${input.tenantSlug}/admin/workstations`)
  // updateTag (not revalidateTag) so the admin who just deleted this
  // workstation sees it gone immediately on next render.
  updateTag(workstationsCacheTag(parsedTenantId.data))
  // PERF-06 / F-PERF-04 Phase 3: removing a workstation removes its
  // capacity_ceiling from scheduling_warning_counts' join, changing the
  // dashboard's cached warning counts.
  updateTag(adminDashboardCacheTag(parsedTenantId.data))

  return {}
}

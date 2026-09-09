'use server'

import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { workstationsCacheTag, adminDashboardCacheTag } from '@/lib/cache/tags'
import type { Json } from '@/types/database'

const tenantIdSchema = z.string().uuid()

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
  windows: WindowInput[]
  todos: string[]
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

  const validTodos = input.todos.map((t) => t.trim()).filter(Boolean)

  const { error: rpcError } = await supabase.rpc('create_workstation', {
    p_tenant_id: parsedTenantId.data,
    p_event_id: input.eventId,
    p_stage_id: input.stageId ?? undefined,
    p_name: input.name.trim(),
    p_description: input.description.trim() || undefined,
    p_capacity_ceiling: input.capacity,
    p_recurring: input.recurring,
    p_windows: validWindows as unknown as Json,
    p_todos: validTodos.map((text, i) => ({
      instruction_text: text,
      position: i,
    })) as unknown as Json,
  })

  if (rpcError) return { error: rpcError.message }

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
  windows: WindowInput[]
  todos: string[]
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

  const validTodos = input.todos.map((t) => t.trim()).filter(Boolean)

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
    p_windows: validWindows as unknown as Json,
    p_todos: validTodos as unknown as Json,
  })

  if (rpcError) return { error: rpcError.message }

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

  if (error) return { error: error.message }

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

'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { translateDbError } from '@/lib/actions/db-error-message'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { adminEventRoutePattern } from '@/lib/events/paths'
import { WORK_AREA_COLORS } from '@/lib/theme/work-area-colors'
import { wallClockToIso } from '@/lib/tasks/time'

// N72. Every write goes through an RPC (migration 20261127105240): save_task
// writes the task, its done flag and its assignees in one transaction, and
// set_task_done (the list's tick) writes the flag together with its audit row. Delete is a plain
// DELETE under tenant_admin_manage_tasks, like deleting a work area.

const uuidSchema = z.string().uuid()
const wallClockSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
const paletteNameSchema = z.enum(WORK_AREA_COLORS.map((c) => c.name) as [string, ...string[]])

export interface SaveTaskInput {
  tenantId: string
  eventId: string
  /** Null creates a new task. */
  taskId: string | null
  stageId: string
  name: string
  description: string
  color: string | null
  /** 'YYYY-MM-DDTHH:mm' wall clock, or null for no start. */
  startsAt: string | null
  /** 'YYYY-MM-DDTHH:mm' wall clock. */
  deadline: string
  done: boolean
  assigneeIds: string[]
}

export interface SaveTaskResult {
  id?: string
  error?: string
}

async function authorize(
  logLabel: string,
  tenantId: string
): Promise<
  | { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; tenantId: string }
  | { error: string }
> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const parsed = uuidSchema.safeParse(tenantId)
  if (!parsed.success) {
    logger.warn(`${logLabel}: invalid tenantId`, { tenantId })
    return { error: await tError('actionErrors.notAuthorized') }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsed.data)))
    return { error: await tError('actionErrors.notAuthorized') }

  return { supabase, tenantId: parsed.data }
}

export async function saveTask(input: SaveTaskInput): Promise<SaveTaskResult> {
  const auth = await authorize('saveTask', input.tenantId)
  if ('error' in auth) return auth
  const { supabase, tenantId } = auth

  const name = input.name.trim()
  if (!name) return { error: await tError('actionErrors.invalidName') }

  if (
    !wallClockSchema.safeParse(input.deadline).success ||
    (input.startsAt !== null && !wallClockSchema.safeParse(input.startsAt).success)
  ) {
    logger.warn('saveTask: invalid time', { deadline: input.deadline, startsAt: input.startsAt })
    return { error: await tError('actionErrors.invalidRequest') }
  }

  const deadline = wallClockToIso(input.deadline)
  const startsAt = input.startsAt ? wallClockToIso(input.startsAt) : null
  if (startsAt && startsAt > deadline) {
    return { error: await tError('actionErrors.taskStartAfterDeadline') }
  }

  const color = paletteNameSchema.safeParse(input.color)

  // The generated Args type marks every parameter non-null, but the function
  // takes null for p_task_id (create), p_description, p_color and p_starts_at.
  const { data, error } = await supabase.rpc('save_task', {
    p_tenant_id: tenantId,
    p_event_id: input.eventId,
    p_task_id: input.taskId,
    p_stage_id: input.stageId,
    p_name: name,
    p_description: input.description.trim() || null,
    p_color: color.success ? color.data : null,
    p_starts_at: startsAt,
    p_deadline: deadline,
    p_done: input.done,
    p_assignee_ids: [...new Set(input.assigneeIds)],
  } as never)

  if (error)
    return {
      error: await translateDbError('saveTask: save_task failed', error, 'tasks.genericSaveError', {
        '23514': 'tasks.startAfterDeadline',
      }),
    }

  revalidatePath(adminEventRoutePattern('tasks'), 'page')
  revalidatePath(adminEventRoutePattern('scheduling'), 'page')

  return { id: (data as { id: string }).id }
}

export interface DeleteTaskInput {
  tenantId: string
  taskId: string
}

export async function deleteTask(input: DeleteTaskInput): Promise<{ error?: string }> {
  const auth = await authorize('deleteTask', input.tenantId)
  if ('error' in auth) return auth
  const { supabase, tenantId } = auth

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', input.taskId)
    .eq('tenant_id', tenantId)

  if (error)
    return {
      error: await translateDbError('deleteTask: delete failed', error, 'tasks.genericDeleteError'),
    }

  revalidatePath(adminEventRoutePattern('tasks'), 'page')
  revalidatePath(adminEventRoutePattern('scheduling'), 'page')

  return {}
}

export interface SetTaskDoneInput {
  tenantId: string
  taskId: string
  done: boolean
}

export interface SetTaskDoneResult {
  done?: boolean
  error?: string
}

export async function setTaskDone(input: SetTaskDoneInput): Promise<SetTaskDoneResult> {
  const auth = await authorize('setTaskDone', input.tenantId)
  if ('error' in auth) return auth
  const { supabase } = auth

  const { data, error } = await supabase.rpc('set_task_done', {
    p_task_id: input.taskId,
    p_done: input.done,
  })

  if (error)
    return {
      error: await translateDbError(
        'setTaskDone: set_task_done failed',
        error,
        'tasks.genericSaveError'
      ),
    }

  revalidatePath(adminEventRoutePattern('tasks'), 'page')
  revalidatePath(adminEventRoutePattern('scheduling'), 'page')

  return { done: (data as { done: boolean }).done }
}

import type { createSupabaseServerClient } from '@/lib/supabase/server'

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

/** One row of a task list: the Tasks page and the block below SCHED-01. */
export interface TaskListItem {
  id: string
  name: string
  color: string | null
  stage_id: string
  starts_at: string | null
  deadline: string
  done: boolean
  assigneeNames: string[]
  checklistDone: number
  checklistTotal: number
}

/**
 * An event's tasks, by deadline, through the admin's own session (RLS:
 * tenant_admin_manage_*). `stageId` narrows to one stage, as the scheduling
 * page does for the stage on screen.
 */
export async function fetchTaskListItems(
  supabase: SupabaseClient,
  tenantId: string,
  eventId: string,
  stageId?: string
): Promise<TaskListItem[]> {
  let query = supabase
    .from('tasks')
    .select(
      'id, name, color, stage_id, starts_at, deadline, done, task_assignees(official_id, officials!task_assignees_official_tenant_fkey(name)), task_todos(item_type, checked)'
    )
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId)
  if (stageId) query = query.eq('stage_id', stageId)

  const { data, error } = await query.order('deadline', { ascending: true })
  if (error) throw error

  return (data ?? []).map((task) => {
    const checkboxes = (task.task_todos ?? []).filter((todo) => todo.item_type === 'checkbox')
    return {
      id: task.id,
      name: task.name,
      color: task.color,
      stage_id: task.stage_id,
      starts_at: task.starts_at,
      deadline: task.deadline,
      done: task.done,
      assigneeNames: (task.task_assignees ?? [])
        .map((a) => a.officials?.name ?? '')
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
      checklistDone: checkboxes.filter((todo) => todo.checked).length,
      checklistTotal: checkboxes.length,
    }
  })
}

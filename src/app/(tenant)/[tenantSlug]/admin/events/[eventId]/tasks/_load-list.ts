import type { createSupabaseServerClient } from '@/lib/supabase/server'

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

/**
 * One task as the admin sees it: a row of the Tasks page and of the block
 * below SCHED-01, and everything the edit dialog opens with, so opening it
 * needs no second read.
 */
export interface TaskListItem {
  id: string
  name: string
  description: string | null
  color: string | null
  stage_id: string
  starts_at: string | null
  deadline: string
  done: boolean
  assigneeIds: string[]
  assigneeNames: string[]
}

/** An official the task dialog can assign: a confirmed member of the event. */
export interface AssignableOfficial {
  id: string
  name: string
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
      'id, name, description, color, stage_id, starts_at, deadline, done, task_assignees(official_id, officials!task_assignees_official_tenant_fkey(name))'
    )
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId)
  if (stageId) query = query.eq('stage_id', stageId)

  const { data, error } = await query.order('deadline', { ascending: true })
  if (error) throw error

  return (data ?? []).map((task) => {
    const assignees = [...(task.task_assignees ?? [])].sort((a, b) =>
      (a.officials?.name ?? '').localeCompare(b.officials?.name ?? '')
    )
    return {
      id: task.id,
      name: task.name,
      description: task.description,
      color: task.color,
      stage_id: task.stage_id,
      starts_at: task.starts_at,
      deadline: task.deadline,
      done: task.done,
      assigneeIds: assignees.map((a) => a.official_id),
      assigneeNames: assignees.map((a) => a.officials?.name ?? '').filter(Boolean),
    }
  })
}

/**
 * The officials a task can be given to: confirmed members of this event — the
 * same rule save_task enforces.
 */
export async function fetchAssignableOfficials(
  supabase: SupabaseClient,
  tenantId: string,
  eventId: string
): Promise<AssignableOfficial[]> {
  const { data, error } = await supabase
    .from('officials')
    .select('id, name, official_events!inner(event_id)')
    .eq('tenant_id', tenantId)
    .eq('invite_status', 'confirmed')
    .eq('official_events.event_id', eventId)
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []).map((o) => ({ id: o.id, name: o.name }))
}

import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import TasksList, { type TaskListItem } from './_components/tasks-list'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string }>
}

// N72: the admin's Tasks page. Read uncached through the admin's own session
// (RLS: tenant_admin_manage_*), for the same reason the work areas page reads
// uncached — an admin must see their own save on the very next render.
export default async function TasksPage({ params }: Props) {
  const { tenantSlug, eventId } = await params

  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const tenant = await getAdminTenant(tenantSlug)
  if (!tenant) notFound()

  const supabase = await createSupabaseServerClient()

  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const [{ data: stages, error: stagesError }, { data: tasks, error: tasksError }] =
    await Promise.all([
      supabase
        .from('event_stages')
        .select('id, name, stage_type, start_time, end_time')
        .eq('event_id', event.id)
        .eq('tenant_id', tenant.id)
        .order('position', { ascending: true }),
      supabase
        .from('tasks')
        .select(
          'id, name, color, stage_id, starts_at, deadline, done, task_assignees(official_id, officials!task_assignees_official_tenant_fkey(name)), task_todos(item_type, checked)'
        )
        .eq('event_id', event.id)
        .eq('tenant_id', tenant.id)
        .order('deadline', { ascending: true }),
    ])

  if (stagesError) throw stagesError
  if (tasksError) throw tasksError

  const items: TaskListItem[] = (tasks ?? []).map((task) => {
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

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <TasksList tenantId={tenant.id} stages={stages ?? []} tasks={items} />
    </div>
  )
}

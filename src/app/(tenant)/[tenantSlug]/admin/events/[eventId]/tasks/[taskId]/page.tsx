import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import TaskForm from '../_components/task-form'
import { loadTaskFormData } from '../_load-form-data'
import { isoToWallClock } from '@/lib/tasks/time'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string; taskId: string }>
}

export default async function EditTaskPage({ params }: Props) {
  const { tenantSlug, eventId, taskId } = await params

  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const tenant = await getAdminTenant(tenantSlug)
  if (!tenant) notFound()

  const supabase = await createSupabaseServerClient()

  const [data, { data: task, error: taskError }] = await Promise.all([
    loadTaskFormData(supabase, tenant.id, eventId, taskId),
    supabase
      .from('tasks')
      .select(
        'id, stage_id, name, description, color, starts_at, deadline, done, task_assignees(official_id), task_todos(id, instruction_text, position, item_type)'
      )
      .eq('id', taskId)
      .eq('event_id', eventId)
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
  ])

  if (taskError) throw taskError
  if (!task) notFound()

  const todos = [...(task.task_todos ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((todo) => ({
      id: todo.id,
      text: todo.instruction_text,
      itemType: todo.item_type === 'checkbox' ? ('checkbox' as const) : ('info' as const),
    }))

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <TaskForm
        tenantId={tenant.id}
        eventId={eventId}
        stages={data.stages}
        officials={data.officials}
        takenByStage={data.takenByStage}
        initial={{
          id: task.id,
          stageId: task.stage_id,
          name: task.name,
          description: task.description ?? '',
          color: task.color,
          startsAt: isoToWallClock(task.starts_at),
          deadline: isoToWallClock(task.deadline)!,
          done: task.done,
          assigneeIds: (task.task_assignees ?? []).map((a) => a.official_id),
          todos,
        }}
        preselectedStageId={null}
        defaultColor={task.color ?? ''}
      />
    </div>
  )
}

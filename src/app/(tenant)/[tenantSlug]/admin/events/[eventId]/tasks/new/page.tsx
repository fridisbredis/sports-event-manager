import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { firstFreeWorkAreaColor } from '@/lib/theme/work-area-colors'
import TaskForm from '../_components/task-form'
import { loadTaskFormData } from '../_load-form-data'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string }>
  searchParams: Promise<{ stageId?: string }>
}

export default async function NewTaskPage({ params, searchParams }: Props) {
  const { tenantSlug, eventId } = await params
  const { stageId } = await searchParams

  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const tenant = await getAdminTenant(tenantSlug)
  if (!tenant) notFound()

  const supabase = await createSupabaseServerClient()
  const data = await loadTaskFormData(supabase, tenant.id, eventId, null)

  // A task must have a stage; with none defined the list page explains where
  // to add one, so there is nothing to show here.
  if (data.stages.length === 0) redirect(`/${tenantSlug}/admin/events/${eventId}/tasks`)

  const preselectedStageId = data.stages.some((s) => s.id === stageId)
    ? (stageId as string)
    : data.stages[0].id

  const defaultColor = firstFreeWorkAreaColor(
    (data.takenByStage[preselectedStageId] ?? []).map((entry) => entry.color)
  ).name

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <TaskForm
        tenantId={tenant.id}
        eventId={eventId}
        stages={data.stages}
        officials={data.officials}
        takenByStage={data.takenByStage}
        initial={null}
        preselectedStageId={preselectedStageId}
        defaultColor={defaultColor}
      />
    </div>
  )
}

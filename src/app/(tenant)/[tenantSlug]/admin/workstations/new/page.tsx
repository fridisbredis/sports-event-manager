import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import WorkstationForm from './_components/workstation-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ stageId?: string }>
}

export default async function NewWorkstationPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const { stageId: preselectedStageId } = await searchParams

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout above already
  // resolved and authorized this tenant, so this reuses that result
  // instead of repeating the GoTrue round trip and the access-context
  // queries. The check still runs for this page — it is not skipped.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  const { data: event } = await supabase
    .from('events')
    .select('id, scheduling_granularity_min')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const { data: stages, error: stagesError } = await supabase
    .from('event_stages')
    .select('id, name, stage_type, start_time, end_time')
    .eq('event_id', event.id)
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true })

  if (stagesError) throw stagesError

  const preselectedStage = stages?.find((s) => s.id === preselectedStageId) ?? null

  return (
    <div className="px-8 py-8">
      <WorkstationForm
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        eventId={event.id}
        preselectedStage={preselectedStage}
        schedulingGranularityMin={event.scheduling_granularity_min}
      />
    </div>
  )
}

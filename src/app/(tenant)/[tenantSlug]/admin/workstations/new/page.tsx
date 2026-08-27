import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import WorkstationForm from './_components/workstation-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ stageId?: string }>
}

export default async function NewWorkstationPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const { stageId: preselectedStageId } = await searchParams

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  if (!(await hasAdminAccessToTenant(user.id, tenant.id))) notFound()

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

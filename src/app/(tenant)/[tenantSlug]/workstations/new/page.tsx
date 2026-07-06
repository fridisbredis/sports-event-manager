import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
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

  const service = await createSupabaseServiceClient()
  const { data: roleRow } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!roleRow || (roleRow.role !== 'tenant_admin' && roleRow.role !== 'system_admin')) {
    notFound()
  }

  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const { data: stages } = await supabase
    .from('event_stages')
    .select('id, name, stage_type, start_time, end_time')
    .eq('event_id', event.id)
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true })

  const preselectedStage = stages?.find((s) => s.id === preselectedStageId) ?? null

  return (
    <div className="px-8 py-8">
      <WorkstationForm
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        eventId={event.id}
        stages={stages ?? []}
        preselectedStage={preselectedStage}
      />
    </div>
  )
}

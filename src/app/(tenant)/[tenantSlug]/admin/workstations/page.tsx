import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import WorkstationsList from './_components/workstations-list'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function WorkstationsPage({ params }: Props) {
  const { tenantSlug } = await params

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

  const service = await createSupabaseServiceClient()

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

  const { data: workstations } = await supabase
    .from('workstations')
    .select(
      'id, name, capacity_ceiling, stage_id, workstation_operating_windows(window_start, window_end)'
    )
    .eq('event_id', event.id)
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: true })

  return (
    <div className="px-8 py-8">
      <WorkstationsList
        tenantSlug={tenantSlug}
        stages={stages ?? []}
        workstations={workstations ?? []}
      />
    </div>
  )
}

import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
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

  const { data: workstations } = await supabase
    .from('workstations')
    .select(
      'id, name, capacity_ceiling, stage_id, event_stages(name, stage_type), workstation_operating_windows(window_start, window_end)'
    )
    .eq('event_id', event.id)
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: true })

  return (
    <div className="px-8 py-8">
      <WorkstationsList tenantSlug={tenantSlug} workstations={workstations ?? []} />
    </div>
  )
}

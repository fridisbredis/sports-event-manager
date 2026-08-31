import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import WorkstationsList from './_components/workstations-list'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function WorkstationsPage({ params }: Props) {
  const { tenantSlug } = await params

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
    .select('id')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const { data: stages, error: stagesError } = await supabase
    .from('event_stages')
    .select('id, name, stage_type, start_time, end_time')
    .eq('event_id', event.id)
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true })

  const { data: workstations, error: workstationsError } = await supabase
    .from('workstations')
    .select(
      'id, name, capacity_ceiling, stage_id, workstation_operating_windows(window_start, window_end)'
    )
    .eq('event_id', event.id)
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: true })

  const queryError = stagesError ?? workstationsError
  if (queryError) throw queryError

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

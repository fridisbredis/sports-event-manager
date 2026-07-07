import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { SchedulingGrid } from './_components/scheduling-grid'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function SchedulingPage({ params }: Props) {
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
    .select('id, scheduling_granularity_min')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const [{ data: stages }, { data: workstations }, { data: officials }, { data: assignments }] =
    await Promise.all([
      supabase
        .from('event_stages')
        .select('id, name, stage_type, stage_date, start_time, end_time')
        .eq('event_id', event.id)
        .eq('tenant_id', tenant.id)
        .order('position', { ascending: true }),

      supabase
        .from('workstations')
        .select('id, name, capacity_ceiling, stage_id, workstation_operating_windows(id, window_start, window_end)')
        .eq('event_id', event.id)
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: true }),

      supabase
        .from('officials')
        .select('id, name, invite_status')
        .eq('tenant_id', tenant.id)
        .eq('invite_status', 'confirmed')
        .order('name', { ascending: true }),

      supabase
        .from('assignments')
        .select('id, official_id, workstation_id, timeslot_start, timeslot_end, status, slot_index')
        .eq('tenant_id', tenant.id),
    ])

  return (
    <div className="px-8 py-8">
      <SchedulingGrid
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        eventId={event.id}
        granularityMin={event.scheduling_granularity_min}
        stages={stages ?? []}
        workstations={workstations ?? []}
        officials={officials ?? []}
        initialAssignments={assignments ?? []}
      />
    </div>
  )
}

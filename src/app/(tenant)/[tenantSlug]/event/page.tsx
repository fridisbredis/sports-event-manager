import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import EventConfigForm from './_components/event-config-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function EventConfigPage({ params }: Props) {
  const { tenantSlug } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, slug, is_active')
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
    .select(
      'id, name, event_type, description, location, logo_url, start_date, end_date, status, scheduling_granularity_min, category_type'
    )
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const [{ data: stages }, { data: distances }, { data: facilities }] = await Promise.all([
    supabase
      .from('event_stages')
      .select('name, stage_date, venue, position')
      .eq('event_id', event.id)
      .order('position', { ascending: true }),
    supabase
      .from('event_distances')
      .select('label, position')
      .eq('event_id', event.id)
      .order('position', { ascending: true }),
    supabase
      .from('event_facilities')
      .select('label, position')
      .eq('event_id', event.id)
      .order('position', { ascending: true }),
  ])

  const isPublished = event.status === 'published'

  return (
    <div className="px-8 py-8">
      <EventConfigForm
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        eventId={event.id}
        initialName={event.name ?? ''}
        initialEventType={event.event_type ?? ''}
        initialDescription={event.description ?? ''}
        initialLocation={event.location ?? ''}
        initialLogoUrl={event.logo_url ?? ''}
        initialStartDate={event.start_date ?? ''}
        initialEndDate={event.end_date ?? ''}
        initialGranularity={event.scheduling_granularity_min}
        initialCategoryType={(event.category_type as 'distance' | 'time') ?? 'distance'}
        initialStages={(stages ?? []).map((s) => ({
          name: s.name,
          stage_date: s.stage_date,
          venue: s.venue ?? '',
          position: s.position,
        }))}
        initialDistances={(distances ?? []).map((d) => ({
          label: d.label,
          position: d.position,
        }))}
        initialFacilities={(facilities ?? []).map((f) => ({
          label: f.label,
          position: f.position,
        }))}
        isPublished={isPublished}
      />
    </div>
  )
}

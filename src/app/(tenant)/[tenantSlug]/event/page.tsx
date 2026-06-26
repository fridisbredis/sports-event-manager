import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
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
      'id, name, event_type, description, location, logo_url, start_date, end_date, status, scheduling_granularity_min'
    )
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const { data: stages } = await supabase
    .from('event_stages')
    .select('name, stage_date, venue, position')
    .eq('event_id', event.id)
    .order('position', { ascending: true })

  const isPublished = event.status === 'published'

  return (
    <div className="px-10 py-10 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <Link href={`/${tenantSlug}/dashboard`} className="hover:text-gray-600 transition-colors">
              Dashboard
            </Link>
            <span>›</span>
            <span className="text-gray-600">Event configuration</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">{tenant.name}</h1>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
            isPublished
              ? 'bg-green-50 text-green-700 ring-1 ring-green-600/20'
              : 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20'
          }`}
        >
          {isPublished ? 'Published' : 'Draft'}
        </span>
      </div>

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
        initialStages={(stages ?? []).map((s) => ({
          name: s.name,
          stage_date: s.stage_date,
          venue: s.venue ?? '',
          position: s.position,
        }))}
        isPublished={isPublished}
      />
    </div>
  )
}

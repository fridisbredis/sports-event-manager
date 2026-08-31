import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import EventConfigForm from './_components/event-config-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function EventConfigPage({ params }: Props) {
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
    .select(
      'id, name, event_type, description, location, logo_url, status, scheduling_granularity_min'
    )
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const [
    { data: stages, error: stagesError },
    { data: distances, error: distancesError },
    { data: facilities, error: facilitiesError },
  ] = await Promise.all([
    supabase
      .from('event_stages')
      .select('id, name, stage_type, race_type, start_time, end_time, venue, position')
      .eq('event_id', event.id)
      .order('position', { ascending: true }),
    supabase
      .from('event_distances')
      .select('label, position, stage_id')
      .eq('event_id', event.id)
      .order('position', { ascending: true }),
    supabase
      .from('event_facilities')
      .select('label, position')
      .eq('event_id', event.id)
      .order('position', { ascending: true }),
  ])

  const queryError = stagesError ?? distancesError ?? facilitiesError
  if (queryError) throw queryError

  const isPublished = event.status === 'published'

  // Build per-stage distances map (stage_id → distances[])
  const distancesByStageId: Record<string, { label: string; position: number }[]> = {}
  for (const d of distances ?? []) {
    if (!d.stage_id) continue
    if (!distancesByStageId[d.stage_id]) distancesByStageId[d.stage_id] = []
    distancesByStageId[d.stage_id].push({ label: d.label, position: d.position })
  }

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
        initialColorPalette={tenant.color_palette}
        initialGranularity={event.scheduling_granularity_min}
        initialStages={(stages ?? []).map((s, i) => ({
          id: s.id,
          name: s.name,
          stage_type: (s.stage_type as 'race' | 'non_race') ?? 'race',
          race_type: (s.race_type as 'distance' | 'time') ?? 'distance',
          start_time: s.start_time ? s.start_time.slice(0, 16) : null,
          end_time: s.end_time ? s.end_time.slice(0, 16) : null,
          venue: s.venue ?? '',
          position: s.position ?? i,
          distances: distancesByStageId[s.id] ?? [],
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

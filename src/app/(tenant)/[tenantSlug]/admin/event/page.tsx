import { redirect, notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { adminEventCacheTag } from '@/lib/cache/tags'
import EventConfigForm from './_components/event-config-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

interface AdminEventCached {
  event: {
    id: string
    name: string | null
    event_type: string | null
    description: string | null
    location: string | null
    logo_url: string | null
    status: string
    scheduling_granularity_min: number
  } | null
  stages: Array<{
    id: string
    name: string
    stage_type: string
    race_type: string
    start_time: string | null
    end_time: string | null
    venue: string | null
    position: number
  }>
  distances: Array<{ label: string; position: number; stage_id: string | null }>
  facilities: Array<{ label: string; position: number }>
}

export default async function EventConfigPage({ params }: Props) {
  const { tenantSlug } = await params

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout above already
  // resolved and authorized this tenant, so this reuses that result
  // instead of repeating the GoTrue round trip and the access-context
  // queries. The check still runs for this page — it is not skipped.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  // PERF-06 / F-PERF-04 Phase 2 (ADR-0003): reads moved behind
  // get_admin_event_cached (migration 0052). Must be the service-role
  // client — unstable_cache can't reach cookies(), and this is only safe
  // because the RPC is SECURITY DEFINER owned by cache_rpc_reader
  // (NOBYPASSRLS), so service_role's own BYPASSRLS never applies inside it.
  const getAdminEventCached = unstable_cache(
    async (tenantId: string) => {
      const service = createSupabaseServiceClient()
      const { data, error } = await service.rpc('get_admin_event_cached', {
        p_tenant_id: tenantId,
      })
      if (error) throw error
      return data as unknown as AdminEventCached
    },
    ['admin-event'], // cache namespace, data-shape only — tenant scoping
    // comes entirely from the tenantId closure argument reaching both the
    // RPC call above and the tags array below
    {
      tags: [adminEventCacheTag(tenant.id)],
      revalidate: 60,
    }
  )

  const { event, stages, distances, facilities } = await getAdminEventCached(tenant.id)

  if (!event) notFound()

  const isPublished = event.status === 'published'

  // Build per-stage distances map (stage_id → distances[])
  const distancesByStageId: Record<string, { label: string; position: number }[]> = {}
  for (const d of distances) {
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
        initialStages={stages.map((s) => ({
          id: s.id,
          name: s.name,
          stage_type: s.stage_type as 'race' | 'non_race',
          race_type: s.race_type as 'distance' | 'time',
          start_time: s.start_time ? s.start_time.slice(0, 16) : null,
          end_time: s.end_time ? s.end_time.slice(0, 16) : null,
          venue: s.venue ?? '',
          position: s.position,
          distances: distancesByStageId[s.id] ?? [],
        }))}
        initialFacilities={facilities.map((f) => ({
          label: f.label,
          position: f.position,
        }))}
        isPublished={isPublished}
      />
    </div>
  )
}

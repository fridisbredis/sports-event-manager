import { redirect, notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { eventInfoCacheTag } from '@/lib/cache/tags'
import { EventHeaderCard } from './_components/event-header-card'
import { StageCard } from './_components/stage-card'
import { FacilityChips } from './_components/facility-chips'
import { SectionLabel } from './_components/section-label'

interface EventInfoCached {
  event: {
    name: string | null
    event_type: string | null
    description: string | null
    logo_url: string | null
    status: string
  } | null
  stages: Array<{
    id: string
    name: string
    stage_type: string
    start_time: string | null
    end_time: string | null
    venue: string | null
    position: number
  }>
  facilities: Array<{ id: string; label: string; position: number }>
}

interface Props {
  params: Promise<{ tenantSlug: string }>
}

function formatDate(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function formatTime(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

export default async function EventInfoPage({ params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation('en', 'official')

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): shares one auth resolution and one
  // access check with the layout above instead of repeating both.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  // PERF-06 / F-PERF-04 Phase 2 (ADR-0003): reads moved behind
  // get_event_info_cached (migration 0049). Must be the service-role
  // client — unstable_cache can't reach cookies(), and this is only safe
  // because the RPC is SECURITY DEFINER owned by cache_rpc_reader
  // (NOBYPASSRLS), so service_role's own BYPASSRLS never applies inside it.
  const getEventInfoCached = unstable_cache(
    async (tenantId: string) => {
      const service = createSupabaseServiceClient()
      // TODO(PERF-06 Phase 2): temporary `any` cast — get_event_info_cached
      // (migration 0049) isn't in src/types/database.ts yet because that's
      // generated from dev's schema and this migration hasn't been pushed
      // there. Remove the cast once db:types is regenerated post-push.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (service.rpc as any)('get_event_info_cached', {
        p_tenant_id: tenantId,
      })
      if (error) throw error
      return data as unknown as EventInfoCached
    },
    ['event-info'], // cache namespace, data-shape only — tenant scoping
    // comes entirely from the tenantId closure argument reaching both the
    // RPC call above and the tags array below
    {
      tags: [eventInfoCacheTag(tenant.id)],
      revalidate: 60,
    }
  )

  const { event, stages, facilities } = await getEventInfoCached(tenant.id)

  const stageList = stages
  const facilityList = facilities

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('eventInfo.title')}</h1>

      <EventHeaderCard
        name={event?.name ?? '—'}
        eventType={event?.event_type ?? ''}
        logoUrl={event?.logo_url ?? null}
        description={event?.description ?? null}
      />

      {stageList.length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.programme')}</SectionLabel>
          <div className="flex flex-col gap-3">
            {stageList.map((stage) => {
              const timeRange = [formatTime(stage.start_time), formatTime(stage.end_time)]
                .filter(Boolean)
                .join(' – ')
              return (
                <StageCard
                  key={stage.id}
                  stageNumber={stage.position + 1}
                  name={stage.name}
                  date={formatDate(stage.start_time)}
                  timeRange={timeRange}
                  venue={stage.venue}
                />
              )
            })}
          </div>
        </div>
      ) : null}

      {facilityList.length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.facilities')}</SectionLabel>
          <FacilityChips facilities={facilityList} />
        </div>
      ) : null}
    </div>
  )
}

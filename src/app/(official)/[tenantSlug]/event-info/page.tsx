import { redirect, notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { Info, MapPin } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { eventInfoCacheTag } from '@/lib/cache/tags'
import { EventHeaderCard } from './_components/event-header-card'
import { StageCard } from './_components/stage-card'
import { StageDateList } from './_components/stage-date-list'
import { StageVenueCard } from './_components/stage-venue-card'
import { FacilityChips } from './_components/facility-chips'
import { EmptyStateCard } from '@/components/ui/empty-state'
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
    stage_date: string | null
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

// Dates and times render in UTC on purpose. Stage timestamps are stored as
// wall-clock UTC, so reading them back in the viewer's zone would shift an
// 08:00 briefing for anyone travelling to the event from another country.
function formatDate(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

// A stage carries either a full start timestamp or just a date (stage_date,
// set when the admin has pinned the day but not yet the hour). The dates
// section should show the day in both cases, so fall back rather than
// leaving the row blank.
function stageDate(stage: { start_time: string | null; stage_date: string | null }): string {
  if (stage.start_time) return formatDate(stage.start_time)
  // stage_date is a bare 'YYYY-MM-DD'; append UTC midnight so it is not
  // parsed as local time and pulled back a day west of Greenwich.
  if (stage.stage_date) return formatDate(stage.stage_date + 'T00:00:00Z')
  return ''
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
  // get_event_info_cached (migration 0051). Must be the service-role
  // client — unstable_cache can't reach cookies(), and this is only safe
  // because the RPC is SECURITY DEFINER owned by cache_rpc_reader
  // (NOBYPASSRLS), so service_role's own BYPASSRLS never applies inside it.
  const getEventInfoCached = unstable_cache(
    async (tenantId: string) => {
      const service = createSupabaseServiceClient()
      const { data, error } = await service.rpc('get_event_info_cached', {
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

  // Non-race stages (setup, teardown) are internal admin scaffolding. Per
  // INFO-01 officials do see all stages, so they stay — but a stage with
  // neither a day nor a venue has nothing to contribute to those two
  // sections, and an empty row there is noise rather than information.
  const datedStages = stageList.filter((stage) => stageDate(stage) !== '')
  const venuedStages = stageList.filter((stage) => stage.venue)

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="page-title mb-6">{t('eventInfo.title')}</h1>

      <EventHeaderCard
        name={event?.name ?? '—'}
        eventType={event?.event_type ?? ''}
        logoUrl={event?.logo_url ?? null}
        description={event?.description ?? null}
      />

      {/* Dates and venues are the two facts an official checks before the
          event ("which day am I needed, and where do I go"), so they sit
          above the hour-by-hour programme, which matters on the day itself.

          Unlike the two sections below, these drop out entirely when empty.
          They are derived views of the same stage list, so an unpublished
          event would otherwise repeat the identical "nothing yet" card three
          times down the screen; the programme's empty state already says it
          once. */}
      {datedStages.length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.datesByStage')}</SectionLabel>
          <StageDateList
            stages={datedStages.map((stage) => ({
              id: stage.id,
              name: stage.name,
              date: stageDate(stage),
            }))}
          />
        </div>
      ) : null}

      {venuedStages.length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.locationAndVenue')}</SectionLabel>
          <StageVenueCard
            stages={venuedStages.map((stage) => ({
              id: stage.id,
              name: stage.name,
              venue: stage.venue as string,
            }))}
          />
        </div>
      ) : null}

      {/* Both sections keep their label when empty rather than vanishing.
          A stage list that is simply not published yet is a normal state for
          an official opening the app early, and a screen that silently drops
          the heading leaves them unsure whether the app failed to load it. */}
      <div className="mb-8">
        <SectionLabel>{t('eventInfo.programme')}</SectionLabel>
        {stageList.length > 0 ? (
          <div className="flex flex-col gap-3">
            {stageList.map((stage) => {
              // The reference design shows three labelled schedule points per
              // stage (briefing / start / podium). event_stages holds only
              // start_time and end_time, so those three cannot be rendered
              // without new columns and matching EVT-02 fields — tracked
              // separately. Until then the card shows the day and the range
              // that do exist, rather than inventing labels for them.
              const timeRange = [formatTime(stage.start_time), formatTime(stage.end_time)]
                .filter(Boolean)
                .join(' – ')
              return (
                <StageCard
                  key={stage.id}
                  stageNumber={stage.position + 1}
                  name={stage.name}
                  details={[stageDate(stage), timeRange].filter(Boolean)}
                />
              )
            })}
          </div>
        ) : (
          <EmptyStateCard
            Icon={Info}
            title={t('eventInfo.noProgramme')}
            description={t('eventInfo.noProgrammeDescription')}
          />
        )}
      </div>

      <div className="mb-8">
        <SectionLabel>{t('eventInfo.facilities')}</SectionLabel>
        {facilityList.length > 0 ? (
          <FacilityChips facilities={facilityList} />
        ) : (
          <EmptyStateCard
            Icon={MapPin}
            title={t('eventInfo.noFacilities')}
            description={t('eventInfo.noFacilitiesDescription')}
          />
        )}
      </div>
    </div>
  )
}

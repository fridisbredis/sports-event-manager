import { redirect, notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { Info } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { eventInfoCacheTag } from '@/lib/cache/tags'
import { EventHeaderCard } from './_components/event-header-card'
import { StageCard } from './_components/stage-card'
import { FacilityChips } from './_components/facility-chips'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { SectionLabel } from './_components/section-label'
import { formatStageDate, stageTimeRangeParts } from '@/lib/i18n/stage-range'

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
    results_url: string | null
    position: number
  }>
  facilities: Array<{ id: string; label: string; position: number }>
}

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// A stage carries either a full start timestamp or just a date (stage_date,
// set when the admin has pinned the day but not yet the hour). The card
// should show the day in both cases, so fall back rather than leaving the
// row blank.
//
// Formatting itself lives in @/lib/i18n/stage-range, shared with the admin
// stage list (EVT-02): both screens describe the same stage, and when they
// formatted it separately this screen lost the end date and rendered a
// six-day stage as "Sun, 2 Aug · 12:00 – 12:00".
function stageDetails(
  stage: { start_time: string | null; stage_date: string | null; end_time: string | null },
  language: string
): string[] {
  const range = stageTimeRangeParts(stage.start_time, stage.end_time, language)
  // The start's date is already inside `from`, so the range carries the day
  // itself and no separate date detail is added beside it.
  if (range) return [range.to ? `${range.from} – ${range.to}` : range.from]
  // stage_date is a bare 'YYYY-MM-DD'; append UTC midnight so it is not
  // parsed as local time and pulled back a day west of Greenwich.
  if (stage.stage_date) return [formatStageDate(stage.stage_date + 'T00:00:00Z', language)]
  return []
}

export default async function EventInfoPage({ params }: Props) {
  const { tenantSlug } = await params
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'official')

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

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="page-title mb-6">{t('eventInfo.title')}</h1>

      <EventHeaderCard
        name={event?.name ?? '—'}
        eventType={event?.event_type ?? ''}
        logoUrl={event?.logo_url ?? null}
        description={event?.description ?? null}
      />

      {/* One stage list, carrying every fact a stage has — day, hours and
          venue. It replaces three sections that walked the same stages three
          times: "Dates by stage", "Location & venue per stage" and this one
          each repeated the stage names, and the day appeared twice. An
          official scanning for "when and where am I needed" had to assemble
          one stage's answer from three places down the screen.

          The section keeps its label when empty rather than vanishing. A
          stage list that is simply not published yet is a normal state for an
          official opening the app early, and a screen that silently drops the
          heading leaves them unsure whether the app failed to load it. */}
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
              return (
                <StageCard
                  key={stage.id}
                  stageNumber={stage.position + 1}
                  name={stage.name}
                  details={stageDetails(stage, language)}
                  venue={stage.venue}
                  resultsUrl={stage.results_url}
                  resultsLabel={t('eventInfo.raceResults')}
                  copyResultsLabel={t('eventInfo.copyResultsLink')}
                  resultsCopiedLabel={t('eventInfo.resultsLinkCopied')}
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

      {/* The empty state is a muted line, not the boxed card used elsewhere on
          this screen: a framed card with a map pin led officials to expect a
          location view once facilities existed. A single line in the same slot
          the chips occupy says the same thing without promising more. */}
      <div className="mb-8">
        <SectionLabel>{t('eventInfo.facilities')}</SectionLabel>
        {facilityList.length > 0 ? (
          <FacilityChips facilities={facilityList} />
        ) : (
          <p className="text-[15px] leading-relaxed text-ink-label">
            {t('eventInfo.noFacilities')}
          </p>
        )}
      </div>
    </div>
  )
}

import { redirect, notFound } from 'next/navigation'
import { Info } from 'lucide-react'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { EventHeaderCard } from '@/components/event-info/event-header-card'
import { StageCard } from '@/components/event-info/stage-card'
import { InfoSectionCard } from '@/components/event-info/info-section-card'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/event-info/section-label'
import { stageDetails } from '@/components/event-info/stage-details'
import { getEventInfoCached } from '@/lib/events/event-info-cached'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string }>
}

export default async function EventInfoPage({ params }: Props) {
  const { tenantSlug, eventId } = await params
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'official')

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): shares one auth resolution and one
  // access check with the layout above instead of repeating both.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  // Cached read shared with the participant variant (N43); the access
  // check above is what makes it safe to call.
  const { event, stages, info_sections } = await getEventInfoCached(tenant.id, eventId)

  const stageList = stages

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="page-title mb-6">{t('eventInfo.title')}</h1>

      <EventHeaderCard
        name={event?.name ?? '—'}
        eventType={event?.event_type ?? ''}
        logoUrl={event?.logo_url ?? null}
        description={event?.description ?? null}
      />

      {/* N38 (L17): the organiser's info sections come right after the
          identity block, in the admin's order. Officials always see them.
          Participant screens (N43) gate the same data on
          isParticipantSideOpen — this route is official-only.

          No label and no empty state: when there are none the block is
          simply absent (no-info-sections wireframe), unlike the programme
          below, whose empty state tells an official it is not out yet. */}
      {info_sections.length > 0 ? (
        <div className="mb-8 flex flex-col gap-3">
          {info_sections.map((section) => (
            <InfoSectionCard key={section.id} section={section} />
          ))}
        </div>
      ) : null}

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
    </div>
  )
}

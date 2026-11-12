import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getParticipantTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { getEventInfoCached } from '@/lib/events/event-info-cached'
import { isParticipantSideOpen } from '@/lib/events/participant-side'
import { EventHeaderCard } from '@/components/event-info/event-header-card'
import { StageCard } from '@/components/event-info/stage-card'
import { InfoSectionCard } from '@/components/event-info/info-section-card'
import { SectionLabel } from '@/components/event-info/section-label'
import { stageDetails } from '@/components/event-info/stage-details'
import { NotAvailable } from '../../../_components/not-available'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string }>
}

// N43: INFO-01, participant variant. The official screen's blocks in the
// same order — identity, the organiser's info sections (N38, L17), then the
// programme — with the programme narrowed to Race stages, each with its Race
// Results link. Nothing a participant cannot act on: no non-race stages,
// which is where officials' work areas live.
export default async function ParticipantEventInfoPage({ params }: Props) {
  const { tenantSlug, eventId } = await params
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'official')

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  const tenant = await getParticipantTenant(tenantSlug)

  if (!tenant) notFound()

  // get_event_info_cached answers for any event in the tenant, so the event
  // must be one the caller is entered in. Without this a participant could
  // read a sibling event's info by editing the URL.
  if (!tenant.entries.some((e) => e.eventId === eventId)) notFound()

  const { event, stages, info_sections } = await getEventInfoCached(tenant.id, eventId)

  if (!event) notFound()

  if (!isParticipantSideOpen(event, tenant.tier)) {
    return (
      <div className="px-5 pt-10 pb-6">
        <h1 className="page-title mb-6">{t('eventInfo.title')}</h1>
        <NotAvailable
          title={t('participant.home.notAvailableTitle')}
          message={t('participant.home.notAvailable')}
        />
      </div>
    )
  }

  const raceStages = stages
    .filter((s) => s.stage_type === 'race')
    .sort((a, b) => a.position - b.position)

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="page-title mb-6">{t('eventInfo.title')}</h1>

      <EventHeaderCard
        name={event.name ?? '—'}
        eventType={event.event_type ?? ''}
        logoUrl={event.logo_url ?? null}
        description={event.description ?? null}
      />

      {/* No label and no empty state, as on the official screen: with no
          sections the block is simply absent (no-info-sections wireframe). */}
      {info_sections.length > 0 ? (
        <div className="mb-8 flex flex-col gap-3">
          {info_sections.map((section) => (
            <InfoSectionCard key={section.id} section={section} />
          ))}
        </div>
      ) : null}

      {/* No empty state: the runner reached this page through a Race stage
          card, and an event with no Race stages has nothing to put here. */}
      {raceStages.length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.programme')}</SectionLabel>
          <div className="flex flex-col gap-3">
            {raceStages.map((stage, i) => (
              <StageCard
                key={stage.id}
                stageNumber={i + 1}
                name={stage.name}
                details={stageDetails(stage, language)}
                venue={stage.venue}
                resultsUrl={stage.results_url}
                resultsLabel={t('eventInfo.raceResults')}
                copyResultsLabel={t('eventInfo.copyResultsLink')}
                resultsCopiedLabel={t('eventInfo.resultsLinkCopied')}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

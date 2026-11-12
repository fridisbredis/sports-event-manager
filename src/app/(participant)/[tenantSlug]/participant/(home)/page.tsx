import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { ArrowUpRight, ChevronRight, Flag } from 'lucide-react'
import { getCurrentUser, getParticipantTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { formatAnnouncementTime } from '@/lib/i18n/announcement-time'
import { participantEventInfoPath, participantPath } from '@/lib/events/paths'
import { loadParticipantHome, type ParticipantHomeEvent } from '@/lib/participants/participant-home'
import { AppCard } from '@/components/ui/app-card'
import { AnnouncementCard } from '@/components/announcements/announcement-card'
import { NotAvailable } from '../_components/not-available'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

type T = (key: string) => string

function MyResultsLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 inline-flex items-center gap-1 text-[15px] font-semibold text-tenant-primary hover:underline"
    >
      {label}
      <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden="true" />
    </a>
  )
}

// One card per Race stage (L16, O18). Bib and class belong to the
// participant's record in the event, not to the stage, so a runner in two
// stages sees the same bib on both cards — which is true.
function StageCards({ event, t }: { event: ParticipantHomeEvent; t: T }) {
  if (event.stages.length === 0) {
    return <p className="text-[15px] text-ink-muted">{t('participant.home.noStages')}</p>
  }

  const facts = [
    event.bib ? `${t('participant.home.bib')} ${event.bib}` : null,
    event.category ? `${t('participant.home.category')} ${event.category}` : null,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-3">
      {event.stages.map((stage) => (
        <AppCard key={stage.id} className="card-accent-left" bodyClassName="p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tenant-primary-tint text-tenant-primary-tint-text">
              <Flag className="size-5" strokeWidth={2} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-bold leading-snug text-ink">{stage.name}</p>
              {facts.length > 0 ? (
                <p className="mt-0.5 text-[15px] leading-snug text-ink-muted">
                  {facts.join(' · ')}
                </p>
              ) : null}
              {event.raceResultsUrl ? (
                <MyResultsLink url={event.raceResultsUrl} label={t('participant.home.myResults')} />
              ) : null}
            </div>
          </div>
        </AppCard>
      ))}
    </div>
  )
}

function ChevronLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mt-3 flex items-center justify-between rounded-large px-1 py-2 text-[15px] font-semibold text-tenant-primary hover:underline"
    >
      {label}
      <ChevronRight className="size-5" aria-hidden="true" />
    </Link>
  )
}

export default async function ParticipantHomePage({ params }: Props) {
  const { tenantSlug } = await params
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'official')

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass: the same resolution the layout gated on.
  const tenant = await getParticipantTenant(tenantSlug)

  if (!tenant) notFound()

  const { events, latestAnnouncement } = await loadParticipantHome(tenant)
  const single = events.length === 1

  return (
    <div className="px-5 pt-10 pb-6">
      {/* One event — the normal case — is named in the heading itself, as in
          the wireframe. Several get a page title and a heading per event. */}
      <h1 className="page-title mb-6 text-tenant-primary-tint-text">
        {single ? events[0].name : t('participant.home.title')}
      </h1>

      <div className="flex flex-col gap-8">
        {events.map((event) => (
          <section key={event.eventId} aria-label={single ? undefined : event.name}>
            {single ? null : (
              <h2 className="mb-3 text-[17px] font-bold text-tenant-primary-tint-text">
                {event.name}
              </h2>
            )}
            {event.open ? (
              <>
                <StageCards event={event} t={t} />
                {/* With several events the Event info tab cannot know which
                    one is meant, so each event links to its own. With one,
                    the tab already does and this would repeat it. */}
                {single ? null : (
                  <ChevronLink
                    href={participantEventInfoPath(tenantSlug, event.eventId)}
                    label={t('participant.home.eventInfo')}
                  />
                )}
              </>
            ) : (
              <NotAvailable message={t('participant.home.notAvailable')} />
            )}
          </section>
        ))}

        {/* L28: the newest announcement on the participant channel. No empty
            state — the no-announcement wireframe simply leaves the block out.
            The full timeline is ANN-02 (N44), also a tab of its own. */}
        {latestAnnouncement ? (
          <section>
            <p className="section-label mb-3">{t('participant.home.latestAnnouncement')}</p>
            <AnnouncementCard
              time={formatAnnouncementTime(latestAnnouncement.publishedAt, language, t)}
              body={latestAnnouncement.body}
            />
            <ChevronLink
              href={participantPath(tenantSlug, 'announcements')}
              label={t('participant.home.allAnnouncements')}
            />
          </section>
        ) : null}
      </div>
    </div>
  )
}

import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { getCurrentUser, getParticipantTenant } from '@/lib/auth/tenant'
import { getEventInfoCached } from '@/lib/events/event-info-cached'
import { isParticipantSideOpen } from '@/lib/events/participant-side'
import { participantEventIds } from '@/lib/participants/participant-event-ids'
import { participantEventInfoPath } from '@/lib/events/paths'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { CARD_SURFACE } from '@/components/ui/card-styles'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// B29: where the Event info tab leads a participant entered in several
// events. The tab cannot know which event is meant, so the participant
// chooses here (Frida 2026-11-26: always a choice, never a guess at the
// "current" one). With one event there is nothing to choose and it goes
// straight to that event's info, so a stale link or a back-navigation after
// leaving an event still lands somewhere useful.
//
// The parent layout has already gated the tenant on the caller's own entries;
// getEventInfoCached is only asked about those events (it authorises nothing
// itself). A closed event is listed and linked: its info page shows the same
// "not open yet" notice as PAR-01, and the mark here says so up front.
export default async function ParticipantEventPickerPage({ params }: Props) {
  const { tenantSlug } = await params

  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const tenant = await getParticipantTenant(tenantSlug)
  if (!tenant) notFound()

  const eventIds = participantEventIds(tenant.entries)

  if (eventIds.length === 1) {
    redirect(participantEventInfoPath(tenantSlug, eventIds[0]))
  }

  const t = await getServerTranslation(await getUserLanguage(), 'official')

  const infos = await Promise.all(eventIds.map((id) => getEventInfoCached(tenant.id, id)))
  const events = eventIds.map((id, i) => {
    const event = infos[i].event
    return {
      id,
      name: event?.name ?? '—',
      open: event ? isParticipantSideOpen(event, tenant.tier) : false,
    }
  })

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="page-title mb-1">{t('eventInfo.title')}</h1>
      <p className="mb-8 text-[15px] leading-snug text-ink-muted">
        {t('participant.events.subtitle')}
      </p>

      <ul className="flex flex-col gap-3">
        {events.map((event) => (
          <li key={event.id}>
            <Link
              href={participantEventInfoPath(tenantSlug, event.id)}
              className={`card-accent-left flex items-center gap-4 ${CARD_SURFACE} px-4 py-4 transition-colors hover:border-tenant-primary-edge hover:bg-tenant-primary-tint`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-bold leading-snug text-ink">{event.name}</p>
                {event.open ? null : (
                  <p className="mt-0.5 text-[15px] leading-snug text-ink-muted">
                    {t('participant.home.notAvailableTitle')}
                  </p>
                )}
              </div>
              <ChevronRight className="size-5 shrink-0 text-tenant-primary" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

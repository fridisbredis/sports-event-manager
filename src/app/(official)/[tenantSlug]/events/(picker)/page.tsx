import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, ChevronRight } from 'lucide-react'
import { listMemberEvents, type MemberEventSummary } from '@/lib/events/official-event'
import { officialEventPath } from '@/lib/events/paths'
import { formatDateRange } from '@/lib/i18n/date-range'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { EmptyState } from '@/components/ui/empty-state'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// N23: where an official lands after login, and where "Change event" on
// ACCT-01 leads. With one event there is nothing to choose, so it goes
// straight to that event's home — today's experience for everyone. With
// several, each is a card; one the official was added to since they last
// opened it carries a "New" mark, which is the in-app notice that replaces
// an SMS (decided on the N23 card).
//
// The parent layout has checked access to the tenant; listMemberEvents
// shows an official only the events they are a member of.
//
// N35 (L5, L20): the same person can also be a participant — in one of these
// events or in another. Each card then names the role(s) held there. A
// participant-only event is listed but not linked until N43 builds the
// participant screens; the role labels only appear once a participant
// membership exists, so an official-only picker looks exactly as before.
export default async function OfficialEventPickerPage({ params }: Props) {
  const { tenantSlug } = await params
  const events = await listMemberEvents(tenantSlug)

  if (events.length === 1 && events[0].canOpen) {
    redirect(officialEventPath(tenantSlug, events[0].id, 'home'))
  }

  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'official')
  const showRoles = events.some((event) => event.roles.includes('participant'))

  const cardBody = (event: MemberEventSummary) => {
    const dates = formatDateRange(event.start_date, event.end_date, language)
    return (
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[17px] font-bold leading-snug text-ink">
          <span className="truncate">{event.name}</span>
          {event.isNew && (
            <span className="shrink-0 rounded-full bg-tenant-primary-tint px-2 py-0.5 text-[12px] font-semibold text-tenant-primary-tint-text">
              {t('events.new')}
            </span>
          )}
        </p>
        {dates && <p className="mt-0.5 text-[15px] leading-snug text-ink-muted">{dates}</p>}
        {showRoles && (
          <p className="mt-2 flex flex-wrap gap-1.5">
            {event.roles.map((role) => (
              <span
                key={role}
                className="rounded-full border border-edge px-2 py-0.5 text-[12px] font-medium text-ink-muted"
              >
                {t(`events.role.${role}`)}
              </span>
            ))}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="mb-1 text-[22px] font-bold leading-snug text-ink">{t('events.title')}</h1>
      <p className="mb-8 text-[15px] leading-snug text-ink-muted">{t('events.subtitle')}</p>

      {events.length === 0 ? (
        <EmptyState
          Icon={CalendarDays}
          title={t('events.emptyTitle')}
          description={t('events.emptyBody')}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event) => (
            <li key={event.id}>
              {event.canOpen ? (
                <Link
                  href={officialEventPath(tenantSlug, event.id, 'home')}
                  className={`card-accent-left flex items-center gap-4 ${CARD_SURFACE} px-4 py-4 transition-colors hover:border-tenant-primary-edge hover:bg-tenant-primary-tint`}
                >
                  {cardBody(event)}
                  <ChevronRight
                    className="size-5 shrink-0 text-tenant-primary"
                    aria-hidden="true"
                  />
                </Link>
              ) : (
                <div className={`flex items-center gap-4 ${CARD_SURFACE} px-4 py-4`}>
                  {cardBody(event)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

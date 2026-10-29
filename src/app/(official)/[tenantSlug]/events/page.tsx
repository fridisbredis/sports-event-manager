import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, ChevronRight } from 'lucide-react'
import { listOfficialEvents } from '@/lib/events/official-event'
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
// The parent layout has checked access to the tenant; listOfficialEvents
// shows an official only the events they are a member of.
export default async function OfficialEventPickerPage({ params }: Props) {
  const { tenantSlug } = await params
  const events = await listOfficialEvents(tenantSlug)

  if (events.length === 1) redirect(officialEventPath(tenantSlug, events[0].id, 'home'))

  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'official')

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
          {events.map((event) => {
            const dates = formatDateRange(event.start_date, event.end_date, language)
            return (
              <li key={event.id}>
                <Link
                  href={officialEventPath(tenantSlug, event.id, 'home')}
                  className={`card-accent-left flex items-center gap-4 ${CARD_SURFACE} px-4 py-4 transition-colors hover:border-tenant-primary-edge hover:bg-tenant-primary-tint`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[17px] font-bold leading-snug text-ink">
                      <span className="truncate">{event.name}</span>
                      {event.isNew && (
                        <span className="shrink-0 rounded-full bg-tenant-primary-tint px-2 py-0.5 text-[12px] font-semibold text-tenant-primary-tint-text">
                          {t('events.new')}
                        </span>
                      )}
                    </p>
                    {dates && (
                      <p className="mt-0.5 text-[15px] leading-snug text-ink-muted">{dates}</p>
                    )}
                  </div>
                  <ChevronRight
                    className="size-5 shrink-0 text-tenant-primary"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

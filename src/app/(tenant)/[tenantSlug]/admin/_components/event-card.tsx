import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { AppCard } from '@/components/ui/app-card'
import { Chip } from '@/components/ui/chip'
import { adminEventPath } from '@/lib/events/paths'
import { formatDateRange } from '@/lib/i18n/date-range'
import { getServerTranslation } from '@/lib/i18n/server'
import type { TenantEventSummary } from '@/lib/events/tenant-events'
import { ArchiveEventButton } from './archive-event-button'

const STATUS_COLOR = {
  published: 'success',
  draft: 'default',
  archived: 'warning',
} as const

// One event on TEN-01. The name and figures open the event's dashboard; the
// archive action sits apart in the footer so it is never the thing a tap on
// the card lands on.
export async function EventCard({
  tenantSlug,
  event,
  language,
  showParticipants,
}: {
  tenantSlug: string
  event: TenantEventSummary
  language: string
  // Participants are Premium and up (N21), so a Standard tenant's cards
  // leave the figure out rather than show a zero for a feature they lack.
  showParticipants: boolean
}) {
  const t = await getServerTranslation(language, 'admin')
  const isArchived = event.status === 'archived'
  const color = STATUS_COLOR[event.status as keyof typeof STATUS_COLOR] ?? 'default'

  const stats = [
    { label: t('events.stages'), value: event.stageCount },
    {
      label: t('events.officials'),
      value: t('events.officialsValue', {
        confirmed: event.officialsConfirmed,
        invited: event.officialsInvited,
      }),
    },
    ...(showParticipants
      ? [{ label: t('events.participants'), value: event.participantCount }]
      : []),
  ]

  return (
    <AppCard className={isArchived ? 'opacity-75' : undefined}>
      <Link
        href={adminEventPath(tenantSlug, event.id, 'dashboard')}
        className="group -m-1 block rounded-card-sm p-1"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold text-ink group-hover:underline group-hover:underline-offset-4">
              {event.name.trim() || t('dashboard.eventName')}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {formatDateRange(event.start_date, event.end_date, language) ??
                t('events.datesNotSet')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Chip size="sm" variant="flat" color={color}>
              {t(`events.status.${event.status}`)}
            </Chip>
            <ChevronRight className="size-4 text-ink-muted" strokeWidth={1.75} aria-hidden />
          </div>
        </div>

        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="section-label">{stat.label}</dt>
              <dd className="mt-1 text-[15px] font-medium text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </Link>

      <div className="mt-5 flex justify-end border-t border-gray-100 pt-3">
        <ArchiveEventButton
          tenantSlug={tenantSlug}
          eventId={event.id}
          eventName={event.name}
          isArchived={isArchived}
        />
      </div>
    </AppCard>
  )
}

import Link from 'next/link'
import { AppCard } from '@/components/ui/app-card'
import { adminEventPath } from '@/lib/events/paths'
import { formatDateRange } from '@/lib/i18n/date-range'
import { getServerTranslation } from '@/lib/i18n/server'
import type { TenantEventSummary } from '@/lib/events/tenant-events'
import { EventActionsMenu } from './event-actions-menu'

// The dot's colour per status. Tenant-independent, like the status chips
// elsewhere: it reports state, not branding.
const STATUS_DOT = {
  published: 'bg-status-ok-dot',
  draft: 'bg-ink-faint',
  archived: 'bg-amber-500',
} as const

// One event on TEN-01. The whole card opens the event's dashboard; the
// actions menu sits above that link so a tap on it never navigates.
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
  const dot = STATUS_DOT[event.status as keyof typeof STATUS_DOT] ?? STATUS_DOT.draft

  const stats = [
    { label: t('events.stages'), value: event.stageCount },
    {
      label: t('events.officials'),
      // Confirmed is the number that matters for staffing; pending invites
      // ride along quietly rather than doubling the figure's width.
      value: event.officialsConfirmed,
      extra:
        event.officialsInvited > 0
          ? t('events.officialsInvited', { invited: event.officialsInvited })
          : undefined,
    },
    ...(showParticipants
      ? [{ label: t('events.participants'), value: event.participantCount }]
      : []),
  ]

  return (
    // The leading edge is the shared card-accent-left utility, so it curves
    // with the card's radius and matches the other themed lists; greyed out
    // once the event is archived. Hover tints the border in the accent's own
    // 28% tone rather than lifting the shadow, since a hover box-shadow would
    // replace the accent's.
    <AppCard
      className={`relative h-full transition-colors hover:border-tenant-primary-edge ${
        isArchived
          ? 'card-accent-left-themed opacity-75 [--card-accent:theme(colors.edge.DEFAULT)]'
          : 'card-accent-left'
      }`}
      bodyClassName="p-6 pl-7"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold text-ink">
            {/* Stretched: the ::after covers the card, so the whole card is
                the link without nesting the menu button inside an <a>. */}
            <Link
              href={adminEventPath(tenantSlug, event.id, 'dashboard')}
              className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-tenant-primary"
            >
              {event.name.trim() || t('dashboard.eventName')}
            </Link>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
            <span>
              {formatDateRange(event.start_date, event.end_date, language) ??
                t('events.datesNotSet')}
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`size-2 rounded-full ${dot}`} />
              {t(`events.status.${event.status}`)}
            </span>
          </p>
        </div>
        <div className="relative z-10 -mr-2 -mt-1.5">
          <EventActionsMenu
            tenantSlug={tenantSlug}
            eventId={event.id}
            eventName={event.name}
            isArchived={isArchived}
          />
        </div>
      </div>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col-reverse">
            <dt className="mt-0.5 text-[13px] text-ink-label">{stat.label}</dt>
            <dd className="flex items-baseline gap-1.5">
              <span className="text-[26px] font-semibold leading-none tracking-tight text-ink tabular-nums">
                {stat.value}
              </span>
              {stat.extra && (
                <span className="text-[13px] leading-none text-ink-muted">{stat.extra}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </AppCard>
  )
}

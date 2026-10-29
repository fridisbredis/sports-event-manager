import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { getAdminTenant } from '@/lib/auth/tenant'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { readTenantEvents, isEventStatus, EVENT_STATUSES } from '@/lib/events/tenant-events'
import { hasFeature, maxActiveEvents } from '@/lib/tiers/features'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { EmptyState, EmptyStateCard } from '@/components/ui/empty-state'
import { EventCard } from './_components/event-card'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ status?: string }>
}

// N23 / TEN-01: the tenant dashboard. Every event of the tenant with its core
// figures, filtered by status, and the way into each event's own screens.
// It is the admin landing page: login lands here, and so does the sidebar's
// "All events".
//
// The filter is a query parameter rather than client state so a filtered
// list survives a reload and the archive action's revalidation.
export default async function TenantDashboardPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const { status: rawStatus } = await searchParams
  const status = isEventStatus(rawStatus) ? rawStatus : undefined

  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'admin')

  // Memoised: the layout already resolved and authorised this tenant.
  const tenant = await getAdminTenant(tenantSlug)
  if (!tenant) notFound()

  const supabase = await createSupabaseServerClient()
  // The whole list, filtered here rather than in the query: the active count
  // in the header has to count every event, not just the filtered ones, and
  // a tenant has at most a few dozen.
  const allEvents = await readTenantEvents(supabase, tenant.id)
  const events = status ? allEvents.filter((e) => e.status === status) : allEvents

  const activeCount = allEvents.filter((e) => e.status !== 'archived').length
  const cap = maxActiveEvents(tenant.tier)
  const showParticipants = hasFeature(tenant.tier, 'participants')

  const filters = [
    { value: undefined, label: t('events.filterAll') },
    ...EVENT_STATUSES.map((value) => ({ value, label: t(`events.status.${value}`) })),
  ]

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 border-b border-edge pb-5">
        <h1 className="page-title">{t('events.title')}</h1>
        <p className="mt-1.5 text-[14.5px] text-ink-muted">
          {t('events.activeOfCap', { active: activeCount, cap })}
        </p>
      </div>

      {allEvents.length === 0 ? (
        <EmptyStateCard
          Icon={CalendarDays}
          title={t('events.noEventsTitle')}
          description={t('events.noEventsBody')}
        />
      ) : (
        <>
          <nav aria-label={t('events.filterLabel')} className="mb-5 flex flex-wrap gap-2">
            {filters.map((filter) => {
              const isActive = filter.value === status
              return (
                <Link
                  key={filter.value ?? 'all'}
                  href={filter.value ? `?status=${filter.value}` : '?'}
                  aria-current={isActive ? 'page' : undefined}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'border-transparent bg-tenant-primary-tint font-semibold text-tenant-primary-tint-text'
                      : 'border-edge bg-white text-ink-soft hover:text-ink'
                  }`}
                >
                  {filter.label}
                </Link>
              )
            })}
          </nav>

          {events.length === 0 ? (
            // Only reachable with a status filter: with none, an empty list
            // is the no-events state above.
            <EmptyState Icon={CalendarDays} title={t(`events.noMatching.${status}`)} />
          ) : (
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {events.map((event) => (
                <li key={event.id}>
                  <EventCard
                    tenantSlug={tenantSlug}
                    event={event}
                    language={language}
                    showParticipants={showParticipants}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

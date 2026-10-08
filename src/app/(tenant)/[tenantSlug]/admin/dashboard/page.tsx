import { redirect, notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { adminDashboardCacheTag } from '@/lib/cache/tags'
import { DashboardHeader } from './_components/dashboard-header'
import { PublishSection } from './_components/publish-section'
import { OfficialsCard } from './_components/officials-card'
import { SchedulingWarningsCard } from './_components/scheduling-warnings-card'
import { AdminAreasGrid } from './_components/admin-areas-grid'
import { dateLocaleFor } from '@/lib/i18n/date-locale'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

interface AdminDashboardCached {
  event: {
    id: string
    name: string | null
    event_type: string | null
    start_date: string | null
    end_date: string | null
    status: string
    scheduling_granularity_min: number
    logo_url: string | null
  } | null
  officials_invited: number
  officials_confirmed: number
  race_stage_count: number
  over_capacity: number
  double_booked: number
  time_off_clash: number
  earliest_day: string | null
  earliest_stage_id: string | null
}

function formatDateRange(start: string | null, end: string | null, language: string) {
  if (!start || !end) return null
  const s = new Date(start)
  const e = new Date(end)
  const sDay = s.getUTCDate()
  const eDay = e.getUTCDate()
  const locale = dateLocaleFor(language)
  const sMonth = s.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
  const eMonth = e.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
  const year = e.getUTCFullYear()
  if (sMonth === eMonth) return `${sDay}–${eDay} ${sMonth} ${year}`
  return `${sDay} ${sMonth} – ${eDay} ${eMonth} ${year}`
}

export default async function DashboardPage({ params }: Props) {
  const { tenantSlug } = await params
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'admin')

  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout above already
  // resolved and authorized this tenant, so this reuses that result
  // instead of repeating the GoTrue round trip and the access-context
  // queries. The check still runs for this page — it is not skipped.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  // PERF-06 / F-PERF-04 Phase 3 (ADR-0003): the event read, both officials
  // head-counts, the race-stage count, and the scheduling-warning counts
  // (previously five separate round trips, one of them a Postgres RPC) all
  // moved behind get_admin_dashboard_cached (migration 0054). Must be the
  // service-role client — unstable_cache can't reach cookies(), and this is
  // only safe because the RPC is SECURITY DEFINER owned by cache_rpc_reader
  // (NOBYPASSRLS), so service_role's own BYPASSRLS never applies inside it.
  const getAdminDashboardCached = unstable_cache(
    async (tenantId: string) => {
      const service = createSupabaseServiceClient()
      const { data, error } = await service.rpc('get_admin_dashboard_cached', {
        p_tenant_id: tenantId,
      })
      if (error) throw error
      return data as unknown as AdminDashboardCached
    },
    ['admin-dashboard'], // cache namespace, data-shape only — tenant scoping
    // comes entirely from the tenantId closure argument reaching both the
    // RPC call above and the tags array below
    {
      tags: [adminDashboardCacheTag(tenant.id)],
      revalidate: 60,
    }
  )

  const {
    event,
    officials_invited: officialsInvited,
    officials_confirmed: officialsConfirmed,
    race_stage_count: raceStageCount,
    over_capacity: overCapacity,
    double_booked: doubleBooked,
    time_off_clash: timeOffClash,
    earliest_day: earliestDay,
    earliest_stage_id: earliestStageId,
  } = await getAdminDashboardCached(tenant.id)

  const hasName = Boolean(event?.name?.trim())
  const hasRaceStage = raceStageCount > 0
  const canPublish = hasName && hasRaceStage
  const isPublished = event?.status === 'published'

  // Jump straight to where the earliest warning is, rather than the grid's
  // own default (getCurrentStage/today) — otherwise an admin has to hunt for
  // the flagged stage and day manually.
  let reviewHref = `/${tenantSlug}/admin/scheduling`
  if (earliestDay && earliestStageId) {
    const params = new URLSearchParams({
      day: earliestDay,
      stage: earliestStageId,
    })
    reviewHref = `/${tenantSlug}/admin/scheduling?${params.toString()}`
  }
  const totalWarnings = overCapacity + doubleBooked + timeOffClash

  const tenantId = tenant.id

  const dateRange = event ? formatDateRange(event.start_date, event.end_date, language) : null
  const eventName = event?.name?.trim() || t('dashboard.eventName')
  const eventType = event?.event_type?.trim() || null
  const subtitle = [
    eventType ?? t('dashboard.typeNotSet'),
    dateRange ?? t('dashboard.datesNotSet'),
  ].join(' · ')

  return (
    <div className="px-8 py-8">
      <DashboardHeader
        logoUrl={event?.logo_url ?? null}
        eventName={eventName}
        subtitle={subtitle}
        isPublished={isPublished}
        publishedLabel={t('dashboard.published')}
        draftLabel={t('dashboard.draft')}
      />

      <div className="grid grid-cols-[3fr_2fr] gap-5 mb-5">
        <PublishSection
          canPublish={canPublish}
          isPublished={isPublished}
          hasName={hasName}
          hasRaceStage={hasRaceStage}
          tenantSlug={tenantSlug}
          tenantId={tenantId}
          eventId={event?.id ?? null}
        />
        <OfficialsCard
          title={t('dashboard.officials')}
          invited={officialsInvited}
          invitedLabel={t('dashboard.invited')}
          confirmed={officialsConfirmed}
          confirmedLabel={t('dashboard.confirmed')}
        />
      </div>

      <div className="mb-5">
        <SchedulingWarningsCard
          title={t('dashboard.schedulingWarnings')}
          overCapacity={overCapacity}
          overCapacityLabel={t('dashboard.overCapacity')}
          doubleBooked={doubleBooked}
          doubleBookedLabel={t('dashboard.doubleBooked')}
          timeOffClash={timeOffClash}
          timeOffClashLabel={t('dashboard.timeOffClash')}
          allClearLabel={t('dashboard.allClear')}
          issuesLabel={t('dashboard.issues', { count: totalWarnings })}
          reviewHref={reviewHref}
          reviewLabel={t('dashboard.reviewInScheduling')}
        />
      </div>

      <AdminAreasGrid
        title={t('dashboard.adminAreas')}
        tiles={[
          { href: `/${tenantSlug}/admin/event`, title: t('navigation.eventConfig') },
          { href: `/${tenantSlug}/admin/workstations`, title: t('navigation.workstations') },
          { href: `/${tenantSlug}/admin/officials`, title: t('navigation.officials') },
          { href: `/${tenantSlug}/admin/scheduling`, title: t('navigation.scheduling') },
          { href: `/${tenantSlug}/admin/communication`, title: t('navigation.communication') },
          { href: `/${tenantSlug}/admin/account`, title: t('navigation.account') },
        ]}
      />
    </div>
  )
}

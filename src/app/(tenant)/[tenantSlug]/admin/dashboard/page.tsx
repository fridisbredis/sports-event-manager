import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { DashboardHeader } from './_components/dashboard-header'
import { PublishSection } from './_components/publish-section'
import { OfficialsCard } from './_components/officials-card'
import { SchedulingWarningsCard } from './_components/scheduling-warnings-card'
import { AdminAreasGrid } from './_components/admin-areas-grid'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

function formatDateRange(start: string | null, end: string | null) {
  if (!start || !end) return null
  const s = new Date(start)
  const e = new Date(end)
  const sDay = s.getUTCDate()
  const eDay = e.getUTCDate()
  const sMonth = s.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
  const eMonth = e.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
  const year = e.getUTCFullYear()
  if (sMonth === eMonth) return `${sDay}–${eDay} ${sMonth} ${year}`
  return `${sDay} ${sMonth} – ${eDay} ${eMonth} ${year}`
}

export default async function DashboardPage({ params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation('en', 'admin')

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout above already
  // resolved and authorized this tenant, so this reuses that result
  // instead of repeating the GoTrue round trip and the access-context
  // queries. The check still runs for this page — it is not skipped.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  // events and both officials head-counts are independent — none of them
  // depend on each other's result — so all three go in one hop rather than
  // three (PERF-01: ~70 ms per hop under load). Only the stage count
  // genuinely depends on event.id and has to follow.
  //
  // The two officials queries are head-counts, not a row fetch — the row set
  // grows with club size, the counts do not (PERF-06).
  //
  // No event yet is a legitimate state this dashboard renders an empty view
  // for; a failed query is not, and must not look the same.
  const [
    { data: event, error: eventError },
    { count: invitedCount, error: invitedError },
    { count: confirmedCount, error: confirmedError },
  ] = await Promise.all([
    supabase
      .from('events')
      .select(
        'id, name, event_type, start_date, end_date, status, scheduling_granularity_min, logo_url'
      )
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    supabase
      .from('officials')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('invite_status', 'invited'),
    supabase
      .from('officials')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('invite_status', 'confirmed'),
  ])

  if (eventError) throw eventError
  if (invitedError) throw invitedError
  if (confirmedError) throw confirmedError

  const { count: raceStageCount, error: raceStageError } = event
    ? await supabase
        .from('event_stages')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', event.id)
        .eq('stage_type', 'race')
    : { count: 0, error: null }

  if (raceStageError) throw raceStageError

  const officialsInvited = invitedCount ?? 0
  const officialsConfirmed = confirmedCount ?? 0

  const hasName = Boolean(event?.name?.trim())
  const hasRaceStage = (raceStageCount ?? 0) > 0
  const canPublish = hasName && hasRaceStage
  const isPublished = event?.status === 'published'

  // Scheduling warnings cover the whole event (every day, every stage) rather
  // than the single day the scheduling grid itself shows at a time — a
  // dashboard summary that only reflected today would hide a double-booking
  // three days out until an admin happened to click through to that day.
  // Aggregated in Postgres (scheduling_warning_counts, migration 0040) rather
  // than pulling every assignment row into Node — this page's other tiles
  // are all cheap counts, and a naive fetch-then-reduce here would make the
  // dashboard's load time scale with total assignment count for the event.
  let overCapacity = 0
  let doubleBooked = 0
  let reviewHref = `/${tenantSlug}/admin/scheduling`
  if (event) {
    const { data: warningCounts, error: warningCountsError } = await supabase
      .rpc('scheduling_warning_counts', { p_tenant_id: tenant.id, p_event_id: event.id })
      .single()

    if (warningCountsError) throw warningCountsError

    overCapacity = warningCounts.over_capacity
    doubleBooked = warningCounts.double_booked

    // Jump straight to where the earliest warning is, rather than the grid's
    // own default (getCurrentStage/today) — otherwise an admin has to hunt
    // for the flagged stage and day manually.
    //
    // This null check is load-bearing even though the generated types say
    // these three fields are non-nullable. They are not: migration 0040
    // resolves them with scalar subqueries over `earliest_overall`, which is
    // empty whenever the event has no warnings at all — the common case. The
    // types are wrong because Postgres records no nullability for `returns
    // table` output columns, so `supabase gen types` emits every one of them
    // as non-null (`over_capacity` and `double_booked` included). Hand-editing
    // them to the truth is what broke the deploy-dev type gate for four runs;
    // the gate demands byte-equality with the generator, so the truth lives
    // here instead. Do not delete this guard on the strength of the types.
    if (warningCounts.earliest_day && warningCounts.earliest_stage_id) {
      const params = new URLSearchParams({
        day: warningCounts.earliest_day,
        stage: warningCounts.earliest_stage_id,
      })
      reviewHref = `/${tenantSlug}/admin/scheduling?${params.toString()}`
    }
  }
  const totalWarnings = overCapacity + doubleBooked

  const tenantId = tenant.id

  const dateRange = event ? formatDateRange(event.start_date, event.end_date) : null
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
          eventId={event!.id}
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

import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, slug, is_active, tier')
    .eq('slug', tenantSlug)
    .single()
  if (!tenant) notFound()

  if (!(await hasAdminAccessToTenant(user.id, tenant.id))) notFound()

  const { data: event } = await supabase
    .from('events')
    .select('id, name, event_type, start_date, end_date, status, scheduling_granularity_min, logo_url')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  const { count: raceStageCount } = event
    ? await supabase
        .from('event_stages')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', event.id)
        .eq('stage_type', 'race')
    : { count: 0 }

  const { data: officialsData } = await supabase
    .from('officials')
    .select('invite_status')
    .eq('tenant_id', tenant.id)

  const officialsInvited = officialsData?.filter((o) => o.invite_status === 'invited').length ?? 0
  const officialsConfirmed = officialsData?.filter((o) => o.invite_status === 'confirmed').length ?? 0

  const hasName = Boolean(event?.name?.trim())
  const hasRaceStage = (raceStageCount ?? 0) > 0
  const canPublish = hasName && hasRaceStage
  const isPublished = event?.status === 'published'

  // Scheduling warning counts — real values come once scheduling is built
  const overCapacity = 0
  const doubleBooked = 0
  const totalWarnings = overCapacity + doubleBooked

  const tenantId = tenant.id

  const dateRange = event ? formatDateRange(event.start_date, event.end_date) : null
  const eventName = event?.name?.trim() || t('dashboard.eventName')
  const eventType = event?.event_type?.trim() || null
  const subtitle = [eventType ?? t('dashboard.typeNotSet'), dateRange ?? t('dashboard.datesNotSet')].join(' · ')

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
          reviewHref={`/${tenantSlug}/admin/scheduling`}
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

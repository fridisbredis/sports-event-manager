import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { getAdminDashboardCached } from '@/lib/events/admin-dashboard-cached'
import {
  canPublish as tierAllowsPublishing,
  displayedEventStatus,
} from '@/lib/events/participant-side'
import { fetchAdminGuideCounts } from '@/lib/onboarding/admin-guide-counts'
import { fetchAdminGuideDismissed } from '@/lib/onboarding/admin-guide-dismissal'
import { HelpGuide } from './_components/help-guide'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string }>
}

// Help and guide (B22): the onboarding guide and glossary on a page of their
// own. It used to be the dashboard with ?guide=1, which dragged the whole
// dashboard along and, with the guide hidden, did nothing when clicked from
// the dashboard itself. No dashboard data here beyond the guide's progress.
export default async function HelpPage({ params }: Props) {
  const { tenantSlug, eventId } = await params
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'admin')

  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout already authorized this
  // tenant; the check still runs for this page.
  const tenant = await getAdminTenant(tenantSlug)
  if (!tenant) notFound()

  // The same cached read as the dashboard, so the guide's progress agrees
  // with it, and a click between the two costs no extra round trip.
  const {
    event,
    officials_confirmed: confirmedOfficialCount,
    race_stage_count: raceStageCount,
  } = await getAdminDashboardCached(tenant.id, eventId)
  if (!event) notFound()

  const supabase = await createSupabaseServerClient()
  const [guideCounts, hiddenOnDashboard] = await Promise.all([
    fetchAdminGuideCounts(supabase, tenant.id, event.id),
    fetchAdminGuideDismissed(supabase, user.id, event.id),
  ])

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <h1 className="page-title mb-6">{t('navigation.helpGuide')}</h1>
      <HelpGuide
        tenantSlug={tenantSlug}
        eventId={eventId}
        hiddenOnDashboard={hiddenOnDashboard}
        eventConfigComplete={Boolean(event.name?.trim()) && raceStageCount > 0}
        workAreaCount={guideCounts.workAreaCount}
        confirmedOfficialCount={confirmedOfficialCount}
        assignedShiftCount={guideCounts.assignedShiftCount}
        isPublished={displayedEventStatus(event.status, tenant.tier) === 'published'}
        tierAllowsPublish={tierAllowsPublishing(tenant.tier)}
      />
    </div>
  )
}

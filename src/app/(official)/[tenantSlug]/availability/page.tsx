import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { logger } from '@/lib/logger'
import type { UnavailabilityPeriod } from '@/lib/scheduling/unavailability'
import { getEventDateRange, type StageDates } from '@/lib/scheduling/period-bounds'
import { AvailabilityManager } from './_components/availability-manager'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// A guard-rail, not pagination. Scoped to one official within one tenant: a
// person declaring more than 200 separate absences is a data problem, not a
// paging one. Asking for one row past it makes a breach visible in the logs
// rather than silently hiding periods the official believes they declared.
const PERIOD_CEILING = 200

export default async function AvailabilityPage({ params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation(await getUserLanguage(), 'official')

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): shares one auth resolution and one
  // access check with the layout above instead of repeating both.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  // Same condition ACCT-01 uses: a caller who reaches this tenant by role
  // alone (a global system_admin, or a tenant_admin without a roster row) has
  // no officials row to declare against, so the screen has nothing to show.
  const officialId = tenant.officialId
  if (!officialId) notFound()

  // Only the caller's own periods — the RLS policy enforces this, and the
  // explicit filter states the intent at the call site rather than leaving it
  // to the policy alone (defense in depth). Officials deliberately cannot see
  // each other's absences.
  //
  // Past periods are kept rather than filtered out: an official looking at
  // this screen after an event should see what they declared, and silently
  // hiding rows that still exist reads as data loss.
  const { data, error } = await supabase
    .from('official_unavailability')
    .select('id, official_id, starts_at, ends_at, reason')
    .eq('official_id', officialId)
    .eq('tenant_id', tenant.id)
    .order('starts_at', { ascending: true })
    .range(0, PERIOD_CEILING)

  // Fail loud rather than rendering an empty list: showing no periods when the
  // read failed would tell an official they are available when they have said
  // otherwise — the F-REL-10 failure mode, on a screen whose whole purpose is
  // that the declaration is on record.
  if (error) throw error

  // The event's own dates, to bound the picker. Read after the periods rather
  // than in parallel because it is strictly decorative — a failure here must
  // narrow nothing and block nothing.
  //
  // `.maybeSingle()` on events, matching every other read in the app: the
  // schema permits more than one event per tenant and the app fails loud
  // rather than silently picking one (migration 0054).
  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  let stages: StageDates[] = []
  if (event) {
    const { data: stageRows, error: stagesError } = await supabase
      .from('event_stages')
      .select('stage_date, start_time, end_time')
      .eq('event_id', event.id)
      .eq('tenant_id', tenant.id)

    // Deliberately not fatal, unlike the period read above: losing this leaves
    // the picker unbounded, which is a smaller harm than refusing to render
    // the screen an official came here to use. Logged rather than swallowed
    // (F-REL-10) so a persistent failure is visible.
    if (stagesError) {
      logger.error('Official availability: stage dates failed to load', stagesError, {
        tenantId: tenant.id,
        eventId: event.id,
      })
    } else {
      stages = stageRows ?? []
    }
  }

  const eventDates = getEventDateRange(stages)

  const periods = checkReadCeiling((data ?? []) as UnavailabilityPeriod[], {
    ceiling: PERIOD_CEILING,
    page: '(official)/availability',
    message: 'Official availability hit its read ceiling — later periods are missing',
    context: { tenantId: tenant.id, officialId },
  })

  return (
    <div>
      <div className="px-5 pt-10 pb-2">
        <h1 className="text-2xl font-bold text-foreground">{t('availability.pageTitle')}</h1>
      </div>
      <div className="px-5 pb-6">
        <AvailabilityManager tenantSlug={tenantSlug} periods={periods} eventDates={eventDates} />
      </div>
    </div>
  )
}

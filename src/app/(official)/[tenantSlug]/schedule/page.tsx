import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { ScheduleView, type AssignmentRow } from './_components/schedule-view'
import { checkReadCeiling } from '@/lib/db/bounded-read'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// A guard-rail, not pagination. Scoped to one official within one tenant —
// note it is NOT event-scoped: `assignments` has no `event_id`, and the only
// event linkage is `workstation_id` -> `workstations.event_id`, which this
// query never traverses. What holds the row count to a single event's worth of
// shifts is a product invariant enforced elsewhere, not here: every `events`
// read uses `.maybeSingle()`, and migration 0054 records that the schema
// permits more than one event per tenant (no unique constraint on
// `events.tenant_id`) and that the app fails loud rather than picking one.
// Given that, the count tracks how many shifts a person works rather than
// tenant growth, so the ceiling should never be reached. Asking for one row
// past it makes a breach visible in the logs instead of silently shortening
// someone's schedule on event day; `.order` runs before `.range`, so a breach
// drops the furthest-future shifts and keeps the soonest.
//
// Bounds the top-level assignment rows only: the nested workstation_todos
// expansion is unbounded either way, and is PERF-06's caching half rather
// than this ceiling.
const SCHEDULE_CEILING = 500

export default async function SchedulePage({ params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation('en', 'official')

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): shares one auth resolution and one
  // access check with the layout above instead of repeating both.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  // officialId comes from getOfficialTenant's access check (F-PERF-07-style
  // dedup): it already ran this exact lookup under the service client to
  // decide access, so the page doesn't repeat it with the RLS client.
  const officialId = tenant.officialId

  let assignments: AssignmentRow[] = []

  if (officialId) {
    const { data, error: assignmentsError } = await supabase
      .from('assignments')
      .select(
        `
        id,
        timeslot_start,
        timeslot_end,
        status,
        workstations (
          id,
          name,
          description,
          workstation_todos ( id, instruction_text, position )
        )
      `
      )
      .eq('official_id', officialId)
      .eq('tenant_id', tenant.id)
      .eq('status', 'assigned')
      .not('workstation_id', 'is', null)
      .order('timeslot_start')
      .range(0, SCHEDULE_CEILING)

    // An official seeing "no assignments" must mean they have none, not that
    // the query failed — this is the screen they open on event day.
    if (assignmentsError) throw assignmentsError

    assignments = checkReadCeiling((data ?? []) as AssignmentRow[], {
      ceiling: SCHEDULE_CEILING,
      page: '(official)/schedule',
      message: 'Official schedule hit its read ceiling — the schedule is truncated',
      context: { tenantId: tenant.id, officialId },
    })
  }

  const strings = {
    title: t('mySchedule.title'),
    readOnly: t('mySchedule.readOnly'),
    byTime: t('mySchedule.byTime'),
    byWorkstation: t('mySchedule.byWorkstation'),
    noAssignments: t('mySchedule.noAssignments'),
    noAssignmentsDescription: t('mySchedule.noAssignmentsDescription'),
  }

  return <ScheduleView assignments={assignments} strings={strings} />
}

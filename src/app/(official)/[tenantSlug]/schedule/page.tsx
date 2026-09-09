import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { ScheduleView, type AssignmentRow } from './_components/schedule-view'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { distinctDays, dayWindow, resolveSelectedDay } from '@/lib/scheduling/day-window'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ day?: string }>
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
const SCHEDULE_CEILING = 500

export default async function SchedulePage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const { day: requestedDay } = await searchParams
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
  let days: string[] = []
  let selectedDay: string | null = null

  if (officialId) {
    // Query 1 of 2 — the day list. Reads every shift this official has, but
    // only `timeslot_start`: no nested `workstations` and therefore no nested
    // `workstation_todos`, which is the expansion F-PERF-06 names as the
    // uncached cost on this path. This is what makes the split worth an extra
    // round trip — the wide read below now covers one day instead of all of
    // them, and this one carries no nesting to expand.
    //
    // The tab list has to come from the official's own shifts rather than the
    // event's dates: an official working two days of a fourteen-day event
    // should see two tabs, not twelve empty ones.
    //
    // DO NOT wrap this in `unstable_cache`. It looks like the ideal candidate
    // — "which days does this person work" barely changes — but MYSCH-01 is
    // ADR-0003 Group 2 (no caching, and that ADR says outright it is the
    // answer if the question comes up again). A stale day list here is worse
    // than the stale-content case Group 2 was written for: an admin adds a
    // shift on a new day, the cached list has no tab for it, and the official
    // never learns the day exists. A missed shift, silently.
    const { data: dayRows, error: daysError } = await supabase
      .from('assignments')
      .select('timeslot_start')
      .eq('official_id', officialId)
      .eq('tenant_id', tenant.id)
      .eq('status', 'assigned')
      .not('workstation_id', 'is', null)
      .order('timeslot_start')
      .range(0, SCHEDULE_CEILING)

    // An official seeing "no assignments" must mean they have none, not that
    // the query failed — this is the screen they open on event day.
    if (daysError) throw daysError

    const boundedDayRows = checkReadCeiling((dayRows ?? []) as { timeslot_start: string }[], {
      ceiling: SCHEDULE_CEILING,
      page: '(official)/schedule#days',
      message: 'Official schedule day list hit its read ceiling — later days are missing',
      context: { tenantId: tenant.id, officialId },
    })

    days = distinctDays(boundedDayRows.map((row) => row.timeslot_start))
    selectedDay = resolveSelectedDay(requestedDay, days, new Date().toISOString().slice(0, 10))
  }

  if (officialId && selectedDay) {
    // Query 2 of 2 — the selected day's shifts, with the nested expansion.
    // The `.gte`/`.lt` pair is the day window PERF-06 wanted here; the
    // ceiling stays as the same guard-rail the unwindowed read carried, and
    // is now unreachable by construction since one day is a subset of the
    // set query 1 already bounds.
    const { start, end } = dayWindow(selectedDay)

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
      .gte('timeslot_start', start)
      .lt('timeslot_start', end)
      .order('timeslot_start')
      .range(0, SCHEDULE_CEILING)

    if (assignmentsError) throw assignmentsError

    assignments = checkReadCeiling((data ?? []) as AssignmentRow[], {
      ceiling: SCHEDULE_CEILING,
      page: '(official)/schedule',
      message: 'Official schedule hit its read ceiling — the schedule is truncated',
      context: { tenantId: tenant.id, officialId, day: selectedDay },
    })
  }

  const strings = {
    title: t('mySchedule.title'),
    readOnly: t('mySchedule.readOnly'),
    byTime: t('mySchedule.byTime'),
    byWorkstation: t('mySchedule.byWorkstation'),
    noAssignments: t('mySchedule.noAssignments'),
    noAssignmentsDescription: t('mySchedule.noAssignmentsDescription'),
    noAssignmentsOnDay: t('mySchedule.noAssignmentsOnDay'),
    noAssignmentsOnDayDescription: t('mySchedule.noAssignmentsOnDayDescription'),
    dayTabsLabel: t('mySchedule.dayTabsLabel'),
  }

  return (
    <ScheduleView
      assignments={assignments}
      days={days}
      selectedDay={selectedDay}
      tenantSlug={tenantSlug}
      strings={strings}
    />
  )
}

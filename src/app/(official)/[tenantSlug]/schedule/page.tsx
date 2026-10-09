import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { ScheduleView, type AssignmentRow, type CheckMap } from './_components/schedule-view'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { logger } from '@/lib/logger'
import {
  distinctDays,
  dayWindow,
  daysSpanned,
  resolveSelectedDay,
} from '@/lib/scheduling/day-window'
import { periodsOverlap, type UnavailabilityPeriod } from '@/lib/scheduling/unavailability'
import { getEventDateRange, type StageDates } from '@/lib/scheduling/period-bounds'

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
  const t = await getServerTranslation(await getUserLanguage(), 'official')

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
  // Every period this official declared, for the tab list; narrowed to the
  // selected day further down for the strip the view renders.
  let allTimeOff: UnavailabilityPeriod[] = []

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

    // Declared time off, read here rather than after the day is chosen because
    // it feeds the tab list below. Own rows only — the RLS policy allows
    // nothing else, and the explicit filter states that at the call site too.
    //
    // Unscoped by day on purpose: a person declares a handful of periods for
    // an event, so this is a small read, and knowing all of them is what lets
    // a day with time off and no shifts get a tab at all.
    const { data: timeOffRows, error: timeOffError } = await supabase
      .from('official_unavailability')
      .select('id, official_id, starts_at, ends_at, created_by_role')
      .eq('official_id', officialId)
      .eq('tenant_id', tenant.id)
      .order('starts_at')
      .range(0, SCHEDULE_CEILING)

    // Not fatal, unlike the assignment read above: this screen's job on event
    // day is to show the shifts, and losing the time-off strip must not take
    // the schedule with it. Logged rather than swallowed (F-REL-10).
    if (timeOffError) {
      logger.error('Official schedule: time off failed to load', timeOffError, {
        tenantId: tenant.id,
        officialId,
      })
    } else {
      allTimeOff = (timeOffRows ?? []) as UnavailabilityPeriod[]
    }

    // Tabs come from shifts AND declared time off, not shifts alone. A day
    // someone has booked off usually has no shifts on it — that is the whole
    // point of booking it off — so a shifts-only list hid exactly the days the
    // declaration was about, and the official had no way to see on this screen
    // that the organisers had been told.
    //
    // Still not every day of the event: an official working two days of a
    // fourteen-day event should see two tabs, not twelve empty ones. This adds
    // the days that carry something, and nothing else.
    days = distinctDays([
      ...boundedDayRows.map((row) => row.timeslot_start),
      ...allTimeOff.flatMap((period) => daysSpanned(period.starts_at, period.ends_at)),
    ])
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
          color,
          description,
          workstation_todos ( id, instruction_text, position, item_type )
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

  // SHIFT PEERS (Peter, 2026-10-07). Who else is on each of today's shifts.
  //
  // This is what migration 20261006113036's widened `assignments` read exists
  // for: the RLS policy admits a colleague's row only when the caller holds
  // one on the same workstation over the same timeslot, so this query cannot
  // return more than the shifts the viewer actually works — there is no need
  // to re-filter by the viewer's own slots here, and no way to widen it by
  // changing the filters below.
  //
  // Read with the RLS client deliberately, NOT the service role: the policy is
  // the thing that bounds this, and reaching past it would turn a scoped read
  // into a roster dump.
  const shiftPeers = new Map<string, string[]>()

  if (officialId && selectedDay && assignments.length > 0) {
    const { start, end } = dayWindow(selectedDay)

    const { data: peerRows, error: peersError } = await supabase
      .from('assignments')
      .select('workstation_id, timeslot_start, officials ( id, name )')
      .eq('tenant_id', tenant.id)
      .eq('status', 'assigned')
      .not('workstation_id', 'is', null)
      .gte('timeslot_start', start)
      .lt('timeslot_start', end)
      .range(0, SCHEDULE_CEILING)

    // Not fatal: losing the peer list degrades a shift card to what it showed
    // before this feature existed, whereas failing the page would take the
    // schedule with it. Logged rather than swallowed (F-REL-10).
    if (peersError) {
      logger.error('Official schedule: shift peers failed to load', peersError, {
        tenantId: tenant.id,
        officialId,
        day: selectedDay,
      })
    } else {
      for (const row of peerRows ?? []) {
        const peer = row.officials as { id: string; name: string } | null
        // Skip the viewer themselves — "with you on this shift" lists the
        // others, and the policy returns the caller's own rows too.
        if (!peer || peer.id === officialId) continue
        // Keyed on the pair that defines a shift, matching how the RLS policy
        // decides visibility and how the grid groups cells.
        const key = `${row.workstation_id}|${new Date(row.timeslot_start).toISOString()}`
        const list = shiftPeers.get(key)
        if (list) {
          if (!list.includes(peer.name)) list.push(peer.name)
        } else {
          shiftPeers.set(key, [peer.name])
        }
      }
      for (const names of shiftPeers.values()) names.sort((a, b) => a.localeCompare(b))
    }
  }

  // Event bounds for the time-off panel's date picker, mirroring the standalone
  // availability page. Decorative: a failure here leaves the picker unbounded
  // rather than blocking the schedule.
  let eventDates: { min: string; max: string } | null = null

  if (officialId) {
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id')
      .eq('tenant_id', tenant.id)
      .maybeSingle()

    // Logged rather than swallowed (F-REL-10). Not fatal: losing this only
    // leaves the time-off panel's date picker unbounded, and failing the whole
    // schedule over a decorative read would be the worse trade.
    if (eventError) {
      logger.error('Official schedule: event lookup failed', eventError, {
        tenantId: tenant.id,
      })
    }

    if (event) {
      const { data: stageRows, error: stagesError } = await supabase
        .from('event_stages')
        .select('stage_date, start_time, end_time')
        .eq('event_id', event.id)
        .eq('tenant_id', tenant.id)

      if (stagesError) {
        logger.error('Official schedule: stage dates failed to load', stagesError, {
          tenantId: tenant.id,
          eventId: event.id,
        })
      } else {
        eventDates = getEventDateRange((stageRows ?? []) as StageDates[])
      }
    }
  }

  // The periods overlapping the day on screen. Filtered in memory rather than
  // re-queried: the full set is already here for the tab list, and it is small.
  const timeOff = selectedDay
    ? allTimeOff.filter((period) =>
        periodsOverlap(
          period.starts_at,
          period.ends_at,
          dayWindow(selectedDay).start,
          dayWindow(selectedDay).end
        )
      )
    : []

  // Check state for the day on screen. One query for every station the
  // official works today rather than one per station: the shift screen is
  // opened on a phone on event day, and N+1 round trips over a field
  // connection is exactly the shape F-PERF-06 flagged on this path.
  //
  // Read with the RLS client, so what comes back is what this official is
  // allowed to see — the read policy admits any member of the tenant, which
  // is what makes a colleague's tick visible.
  const checks: CheckMap = new Map()

  if (assignments.length > 0) {
    const workstationIds = [
      ...new Set(
        assignments
          .map((a) => a.workstations?.id)
          .filter((id): id is string => typeof id === 'string')
      ),
    ]

    if (workstationIds.length > 0) {
      const { start, end } = dayWindow(selectedDay as string)

      const { data: checkRows, error: checksError } = await supabase
        .from('checklist_item_checks')
        .select('todo_id, timeslot_start, checked_by, checked_at')
        .eq('tenant_id', tenant.id)
        .in('workstation_id', workstationIds)
        .gte('timeslot_start', start)
        .lt('timeslot_start', end)

      // Fail loud rather than rendering every box unticked: silently showing
      // an empty checklist would tell an official the work is outstanding
      // when a colleague has already done it (the F-REL-10 failure mode).
      if (checksError) throw checksError

      // Actor names in one follow-up query rather than a join: PostgREST
      // cannot embed auth.users, and checklist_item_checks has no FK to
      // officials. The names come from the audit trail's denormalised
      // actor_name, which is written at check time for exactly this reason.
      const actorIds = [
        ...new Set(
          (checkRows ?? [])
            .map((r) => r.checked_by)
            .filter((id): id is string => typeof id === 'string')
        ),
      ]

      const namesByUserId = new Map<string, string>()
      if (actorIds.length > 0) {
        const { data: officialRows, error: namesError } = await supabase
          .from('officials')
          .select('user_id, name')
          .eq('tenant_id', tenant.id)
          .in('user_id', actorIds)

        // Deliberately not fatal, unlike the check read above: a missing name
        // degrades one line to the UI's "someone" fallback, whereas a missing
        // CHECK would misreport the work as outstanding. Logged rather than
        // swallowed, so the degradation is visible in monitoring (F-REL-10).
        if (namesError) {
          logger.error('Official schedule: checklist actor names failed to load', namesError, {
            tenantId: tenant.id,
            day: selectedDay,
          })
        }

        for (const row of officialRows ?? []) {
          if (row.user_id) namesByUserId.set(row.user_id, row.name)
        }
      }

      for (const row of checkRows ?? []) {
        checks.set(`${row.todo_id}|${row.timeslot_start}`, {
          checked_by: row.checked_by,
          checked_at: row.checked_at,
          actorName: row.checked_by ? (namesByUserId.get(row.checked_by) ?? null) : null,
        })
      }
    }
  }

  const strings = {
    title: t('mySchedule.title'),
    scheduleOwner: t('mySchedule.scheduleOwner'),
    byTime: t('mySchedule.byTime'),
    byWorkstation: t('mySchedule.byWorkstation'),
    noAssignments: t('mySchedule.noAssignments'),
    noAssignmentsDescription: t('mySchedule.noAssignmentsDescription'),
    noAssignmentsOnDay: t('mySchedule.noAssignmentsOnDay'),
    noAssignmentsOnDayDescription: t('mySchedule.noAssignmentsOnDayDescription'),
    dayTabsLabel: t('mySchedule.dayTabsLabel'),
    todoLabel: t('mySchedule.todoLabel'),
    infoLabel: t('mySchedule.infoLabel'),
    manageAvailability: t('availability.manageLink'),
    timeOffOnDay: t('mySchedule.timeOffOnDay'),
    timeOffSetByOrganisers: t('mySchedule.timeOffSetByOrganisers'),
    timeOffAllDay: t('mySchedule.timeOffAllDay'),
    withYouOnShift: t('mySchedule.withYouOnShift'),
    timeOffClash: t('mySchedule.timeOffClash'),
    timeOffClashAdmin: t('mySchedule.timeOffClashAdmin'),
  }

  // Passed as raw templates, not interpolated here: this object crosses into
  // a Client Component, and only serialisable data survives that boundary —
  // a `(name) => t(...)` callback throws "Functions cannot be passed directly
  // to Client Components". `checkedBy`/`confirmBody` keep their {{name}} and
  // {{time}} placeholders and the row fills them in.
  //
  // `returnObjects: false` is implicit; these keys are plain strings, so
  // i18next returns them verbatim when no interpolation values are given.
  const checklistStrings = {
    toggleLabel: t('checklist.toggleLabel'),
    checkedBy: t('checklist.checkedBy'),
    someone: t('checklist.someone'),
    confirmTitle: t('checklist.confirmTitle'),
    confirmBody: t('checklist.confirmBody'),
    confirmCancel: t('checklist.confirmCancel'),
    confirmConfirm: t('checklist.confirmConfirm'),
    saveFailed: t('checklist.saveFailed'),
  }

  return (
    <ScheduleView
      assignments={assignments}
      days={days}
      selectedDay={selectedDay}
      tenantSlug={tenantSlug}
      strings={strings}
      checks={checks}
      currentUserId={user.id}
      checklistStrings={checklistStrings}
      timeOff={timeOff}
      shiftPeers={shiftPeers}
      allTimeOff={allTimeOff}
      eventDates={eventDates}
    />
  )
}

-- ============================================================================
-- Migration 20261008133456: count shifts scheduled over declared time off
-- ============================================================================
--
-- SCHED-01. The admin dashboard's "Scheduling Warnings" panel showed two
-- numbers, Over capacity and Double-booked, while the scheduling grid itself
-- had grown a third warning of the same kind: an assignment that falls inside
-- a period the official (or an organiser) recorded as time off. The grid
-- banners it as `unavailableAssigned` and marks the cell, but an admin
-- looking at the dashboard saw "0 issues" with clashes sitting in the grid.
--
-- Both functions are replaced rather than extended, because both change
-- shape: `scheduling_warning_counts` gains a column and
-- `get_admin_dashboard_cached` gains a key in its jsonb payload.
--
-- COUNT SEMANTICS
-- Counts DISTINCT officials with at least one assignment overlapping one of
-- their unavailability periods — the same unit as double_booked (a count of
-- people, not of cells), so the two numbers beside each other mean the same
-- kind of thing.
--
-- Overlap is half-open on both sides, `[start, end)`, matching
-- `periodsOverlap` in src/lib/scheduling/unavailability.ts and the CHECK
-- constraint on official_unavailability. An absence ending 15:00 and a shift
-- starting 15:00 are adjacent, not in conflict; closed intervals would read
-- every boundary as a clash.
--
-- Unlike the other two counts this does NOT join workstations: a clash is
-- between a person and their own declared absence, and holds whether or not
-- the assignment has a work area. The join is still needed for stage_id when
-- this warning is the earliest one, so that lookup is a separate left join
-- which leaves stage_id null rather than dropping the row.
--
-- Forward-fix: replaces two functions, plus one additive policy and grant.
--   No data change.
--   Rollback: re-run migration 0040 (scheduling_warning_counts) and
--             0054 (get_admin_dashboard_cached) in that order, which restore
--             the two-count shape. Callers reading the new key must be
--             reverted first — see the shape contract note in 0054. Then:
--             drop policy if exists
--               "cache_rpc_reader_read_official_unavailability"
--               on public.official_unavailability;
--             revoke select on public.official_unavailability
--               from cache_rpc_reader;
--             -- FORCE ROW LEVEL SECURITY is left on deliberately: it is a
--             -- tightening, and 0054 makes the same call for its tables.
-- ============================================================================

-- `create or replace` cannot widen a set-returning function's row type, so
-- the old signature is dropped first. `get_admin_dashboard_cached` is the
-- only caller and is replaced further down in this same migration, inside
-- the same transaction, so nothing observes the gap.
drop function if exists public.scheduling_warning_counts(uuid, uuid);

create function public.scheduling_warning_counts(p_tenant_id uuid, p_event_id uuid)
returns table (
  over_capacity integer,
  double_booked integer,
  time_off_clash integer,
  earliest_timeslot_start timestamptz,
  earliest_stage_id uuid,
  earliest_day date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with over_capacity_cells as (
    select a.workstation_id, a.timeslot_start, w.stage_id
    from public.assignments a
    join public.workstations w
      on w.id = a.workstation_id
     and w.tenant_id = p_tenant_id
     and w.event_id = p_event_id
    where a.tenant_id = p_tenant_id
    group by a.workstation_id, a.timeslot_start, w.capacity_ceiling, w.stage_id
    having count(*) > w.capacity_ceiling
  ),
  double_booked_cells as (
    select a.official_id, a.timeslot_start,
      -- The offending official's workstations may span more than one stage
      -- (e.g. two work areas moved between stages after the double-booking
      -- happened) — arbitrarily pick one (uuid has no natural min/max, so
      -- take the first of an aggregated array), same "good enough to
      -- navigate to" contract as earliest_timeslot_start below rather than
      -- multi-valued.
      (array_agg(w.stage_id))[1] as stage_id
    from public.assignments a
    join public.workstations w
      on w.id = a.workstation_id
     and w.tenant_id = p_tenant_id
     and w.event_id = p_event_id
    where a.tenant_id = p_tenant_id
    group by a.official_id, a.timeslot_start
    having count(distinct a.workstation_id) > 1
  ),
  time_off_clash_cells as (
    -- Left join to workstations: an assignment with no work area is still a
    -- clash with the person's absence, it just cannot say which stage.
    select a.official_id, a.timeslot_start, w.stage_id
    from public.assignments a
    join public.official_unavailability u
      on u.official_id = a.official_id
     and u.tenant_id = p_tenant_id
     and u.starts_at < a.timeslot_end
     and u.ends_at > a.timeslot_start
    left join public.workstations w
      on w.id = a.workstation_id
     and w.tenant_id = p_tenant_id
     and w.event_id = p_event_id
    where a.tenant_id = p_tenant_id
  ),
  -- Each cell set reduced to "when did this warning type first occur" before
  -- picking the overall earliest — keeps the final ORDER BY over a small,
  -- pre-aggregated set instead of the full unioned cell list.
  earliest_over_capacity as (
    select timeslot_start, stage_id from over_capacity_cells
    order by timeslot_start asc limit 1
  ),
  earliest_double_booked as (
    select timeslot_start, stage_id from double_booked_cells
    order by timeslot_start asc limit 1
  ),
  earliest_time_off_clash as (
    select timeslot_start, stage_id from time_off_clash_cells
    order by timeslot_start asc limit 1
  ),
  earliest_overall as (
    select timeslot_start, stage_id from earliest_over_capacity
    union all
    select timeslot_start, stage_id from earliest_double_booked
    union all
    select timeslot_start, stage_id from earliest_time_off_clash
    order by timeslot_start asc limit 1
  )
  select
    (select count(distinct workstation_id) from over_capacity_cells)::int,
    (select count(distinct official_id) from double_booked_cells)::int,
    (select count(distinct official_id) from time_off_clash_cells)::int,
    (select timeslot_start from earliest_overall),
    (select stage_id from earliest_overall),
    (select (timeslot_start at time zone 'UTC')::date from earliest_overall);
$$;

comment on function public.scheduling_warning_counts(uuid, uuid) is
  'Scheduling warning counts for the admin dashboard: over-capacity work areas, double-booked officials, officials scheduled over declared time off, plus where the earliest of those sits.';

-- ---- official_unavailability, for the cache reader ----
-- `get_admin_dashboard_cached` is SECURITY DEFINER and runs as
-- cache_rpc_reader, so the nested scheduling_warning_counts call reads this
-- table as that role. 0054 granted the reader `officials`, `assignments` and
-- (via 0053) `workstations`; this table did not exist then, and without the
-- grant the new join fails with 42501 before RLS is ever consulted.
--
-- A grant alone is not enough: with FORCE RLS on, a row has to be visible to
-- a SELECT policy as well, or the join simply matches nothing and the count
-- comes back a silent zero. Same tenant scoping as the reader's other
-- policies.
drop policy if exists "cache_rpc_reader_read_official_unavailability" on public.official_unavailability;
create policy "cache_rpc_reader_read_official_unavailability"
  on public.official_unavailability for select
  to cache_rpc_reader
  using (current_setting('app.tenant_id', true) = tenant_id::text);

alter table public.official_unavailability force row level security;

grant select on public.official_unavailability to cache_rpc_reader;

-- The dashboard RPC, carried forward from 0054 with one key added to its
-- payload. Reproduced in full because `create or replace function` has no
-- partial form — the body below is 0054's, unchanged apart from the
-- `time_off_clash` key and the shape contract that documents it.
create or replace function public.get_admin_dashboard_cached(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id           uuid;
  v_event              jsonb;
  v_event_count        integer;
  v_officials_invited  integer;
  v_officials_confirmed integer;
  v_race_stage_count   integer;
  v_warnings           record;
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);

  -- The old direct-query page used `.maybeSingle()`, which throws if a
  -- tenant somehow has more than one event row (schema allows it — no
  -- unique constraint on events.tenant_id) rather than silently picking one.
  -- Preserve that fail-loud behavior here instead of an `order by ... limit
  -- 1` that would quietly paper over a data-integrity anomaly.
  --
  -- One query, not count-then-select: `count(*) over ()` is evaluated over
  -- every row matching the WHERE clause before LIMIT truncates the result
  -- (window functions run before LIMIT/ORDER BY per Postgres's execution
  -- order), so this sees the true row count in the same snapshot as the
  -- row it returns. A separate `select count(*) ...` followed by this select
  -- would be two statements under READ COMMITTED — each takes its own
  -- snapshot, so a second event inserted between them could slip past the
  -- count check undetected. Column list matches the `events` select in
  -- admin/dashboard/page.tsx exactly.
  select e.id,
         jsonb_build_object(
           'id', e.id,
           'name', e.name,
           'event_type', e.event_type,
           'start_date', e.start_date,
           'end_date', e.end_date,
           'status', e.status,
           'scheduling_granularity_min', e.scheduling_granularity_min,
           'logo_url', e.logo_url
         ),
         count(*) over ()
    into v_event_id, v_event, v_event_count
  from public.events e
  where e.tenant_id = p_tenant_id
  limit 1;

  if v_event_count > 1 then
    raise exception 'get_admin_dashboard_cached: tenant % has % event rows, expected at most 1',
      p_tenant_id, v_event_count;
  end if;

  select count(*) filter (where o.invite_status = 'invited'),
         count(*) filter (where o.invite_status = 'confirmed')
    into v_officials_invited, v_officials_confirmed
  from public.officials o
  where o.tenant_id = p_tenant_id;

  select count(*)
    into v_race_stage_count
  from public.event_stages s
  where s.event_id = v_event_id
    and s.tenant_id = p_tenant_id
    and s.stage_type = 'race';

  -- v_event_id is NULL when the tenant has no event yet; every join inside
  -- scheduling_warning_counts then matches nothing, so all five columns
  -- come back 0/NULL as appropriate. See header note.
  select *
    into v_warnings
  from public.scheduling_warning_counts(p_tenant_id, v_event_id);

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { id, name, event_type, start_date, end_date, status,
  --              scheduling_granularity_min, logo_url } | null,
  --     officials_invited: number,
  --     officials_confirmed: number,
  --     race_stage_count: number,
  --     over_capacity: number,
  --     double_booked: number,
  --     time_off_clash: number,
  --     earliest_day: string | null,
  --     earliest_stage_id: string | null }
  -- `event` is JSON null when the tenant has no event row — the page's
  -- notFound() signal for the header/publish tiles is elsewhere in the
  -- payload (officials_invited/confirmed and the warning counts stay
  -- meaningful even with no event, matching today's page behaviour).
  return jsonb_build_object(
    'event', v_event,
    'officials_invited', coalesce(v_officials_invited, 0),
    'officials_confirmed', coalesce(v_officials_confirmed, 0),
    'race_stage_count', coalesce(v_race_stage_count, 0),
    'over_capacity', coalesce(v_warnings.over_capacity, 0),
    'double_booked', coalesce(v_warnings.double_booked, 0),
    'time_off_clash', coalesce(v_warnings.time_off_clash, 0),
    'earliest_day', v_warnings.earliest_day,
    'earliest_stage_id', v_warnings.earliest_stage_id
  );
end;
$$;

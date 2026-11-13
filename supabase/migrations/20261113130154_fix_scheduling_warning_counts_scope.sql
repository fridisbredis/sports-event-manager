-- ============================================================================
-- Migration 20261113130154: scope dashboard scheduling warnings correctly
-- ============================================================================
--
-- The dashboard RPC counted every assignment row, including available,
-- on-break and blocked rows, and its time-off CTE could include assignments
-- from a different event in the same tenant. Non-assigned rows can have no
-- workstation, leaving the earliest warning without a stage and sending the
-- review link to the schedule's default day instead of a real issue.
--
-- Forward-fix: replace
--   Rollback: Restore public.scheduling_warning_counts from migration
--             20261008133456_scheduling_warnings_time_off_clash.sql.
--   Data:     no data changes; only the read-only function definition changes.
--   Blast:    until this fix is applied, the dashboard may show false warning
--             counts and its review link may not point to the issue. The
--             scheduling grid itself is unaffected.
--   Window:   compatible — the function signature, return shape, security
--             mode and grants are unchanged, so the currently deployed image
--             continues to call it without changes.
-- ============================================================================

create or replace function public.scheduling_warning_counts(p_tenant_id uuid, p_event_id uuid)
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
      and a.event_id = p_event_id
      and a.status = 'assigned'
    group by a.workstation_id, a.timeslot_start, w.capacity_ceiling, w.stage_id
    having count(*) > w.capacity_ceiling
  ),
  double_booked_cells as (
    select a.official_id, a.timeslot_start,
      (array_agg(w.stage_id))[1] as stage_id
    from public.assignments a
    join public.workstations w
      on w.id = a.workstation_id
     and w.tenant_id = p_tenant_id
     and w.event_id = p_event_id
    where a.tenant_id = p_tenant_id
      and a.event_id = p_event_id
      and a.status = 'assigned'
    group by a.official_id, a.timeslot_start
    having count(distinct a.workstation_id) > 1
  ),
  time_off_clash_cells as (
    select a.official_id, a.timeslot_start, w.stage_id
    from public.assignments a
    join public.official_unavailability u
      on u.official_id = a.official_id
     and u.tenant_id = p_tenant_id
     and u.starts_at < a.timeslot_end
     and u.ends_at > a.timeslot_start
    join public.workstations w
      on w.id = a.workstation_id
     and w.tenant_id = p_tenant_id
     and w.event_id = p_event_id
    where a.tenant_id = p_tenant_id
      and a.event_id = p_event_id
      and a.status = 'assigned'
  ),
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
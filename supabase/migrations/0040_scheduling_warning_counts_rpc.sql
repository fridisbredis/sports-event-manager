-- ============================================================================
-- Migration 0040: scheduling_warning_counts RPC
-- ============================================================================
--
-- The admin dashboard (SCHED-01 companion) previously hardcoded its
-- "Over capacity" / "Double-booked" tile to 0/0 — no query backed it at all.
-- Wiring it up the naive way (pull every assignment row for the tenant into
-- Node, same shape as computeOverCapacityCells/computeDoubleBookedOfficials
-- in src/lib/scheduling/grid-logic.ts) would make the dashboard's load time
-- scale with total assignment count for the event, unlike every other tile
-- on that page which is a cheap count(). This RPC does the same aggregation
-- inside Postgres instead.
--
-- Also returns where the earliest (chronologically first) warning is, so the
-- dashboard's "Review in scheduling" link can jump straight to the right
-- stage and day instead of always landing on the grid's own default
-- (getCurrentStage/today) and making the admin hunt for it manually.
--
-- Count semantics mirror grid-logic.ts exactly:
--   - over capacity: count of DISTINCT workstations where any single
--     timeslot has more assignments than that workstation's capacity_ceiling
--   - double booked: count of DISTINCT officials who have >1 DISTINCT
--     workstation_id for the same timeslot_start (computeDoubleBookedOfficials
--     flags per adjacent-pair-changed, but the net set of flagged
--     official+slot keys is exactly "count(distinct workstation_id) > 1" —
--     verified against the TS implementation before writing this)
--
-- earliest_stage_id is "good enough to navigate to", not authoritative: a
-- double-booked official's two workstations could in principle belong to
-- different stages, in which case min(stage_id) picks one arbitrarily. The
-- grid itself only ever shows one stage at a time, so a single pick is the
-- most this contract can express regardless.
--
-- Scoped to tenant_id only, same as fetchAssignmentsForDay/fetchAllAssignments
-- and every other assignments query in the app — the codebase's one-event-
-- per-tenant assumption (events queried via .eq('tenant_id', ...).maybeSingle()
-- everywhere) means this is not itself a new scoping decision.
--
-- SECURITY INVOKER: read-only, no reason to elevate privilege. `assignments`
-- has only tenant_admin_manage_assignments (FOR ALL, migration 0004) — no
-- separate member-read policy exists, so a non-admin authenticated caller
-- gets rows filtered to nothing by RLS rather than an error. That's already
-- the right, safe behavior (no cross-tenant leak either way), and matches
-- the fact that only the dashboard's admin-gated page calls this today.
-- The explicit tenant_id filters below are defense in depth on top of RLS,
-- not a substitute for it, same as every other RPC in this schema.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.scheduling_warning_counts(uuid);
--   Data:     no data loss — this is a read-only function, no tables changed.
--   Blast:    none. Nothing depends on this function yet except the one
--             dashboard call site being added in the same PR.
--   Window:   compatible. A function is either callable or not; there is no
--             partially-migrated state for old code to be incompatible with.
-- ============================================================================

create or replace function public.scheduling_warning_counts(p_tenant_id uuid)
returns table (
  over_capacity integer,
  double_booked integer,
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
    where a.tenant_id = p_tenant_id
    group by a.official_id, a.timeslot_start
    having count(distinct a.workstation_id) > 1
  ),
  -- Both cell sets reduced to "when did this warning type first occur" before
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
  earliest_overall as (
    select timeslot_start, stage_id from earliest_over_capacity
    union all
    select timeslot_start, stage_id from earliest_double_booked
    order by timeslot_start asc limit 1
  )
  select
    (select count(distinct workstation_id) from over_capacity_cells)::int,
    (select count(distinct official_id) from double_booked_cells)::int,
    (select timeslot_start from earliest_overall),
    (select stage_id from earliest_overall),
    (select (timeslot_start at time zone 'UTC')::date from earliest_overall);
$$;

revoke execute on function public.scheduling_warning_counts(uuid) from public, anon;
grant execute on function public.scheduling_warning_counts(uuid) to authenticated;

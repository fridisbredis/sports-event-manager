-- ============================================================================
-- Migration 20261028140031: the cached admin RPCs read the event they are given (N23)
-- ============================================================================
--
-- get_admin_dashboard_cached, get_admin_event_cached and
-- get_admin_workstations_cached each took only p_tenant_id and picked "the
-- tenant's event" themselves. That breaks the moment a tenant has a second
-- event: the dashboard RAISES ("expected at most 1"), and the other two
-- silently show the oldest event whichever one the admin opened. Since
-- 6a the admin URL names the event, so the screens can pass it.
--
-- Each now takes (p_tenant_id uuid, p_event_id uuid DEFAULT NULL) and reads
-- only that event, still within the tenant. The bodies are the live
-- definitions (pg_get_functiondef) with only the lines marked N23 changed.
--
-- WHY A DEFAULT, AND WHY DROP FIRST. Deployed code calls these with
-- p_tenant_id alone for the length of a deploy window. A defaulted second
-- argument keeps that call resolving to the same function, with the old
-- behaviour (NULL = pick the tenant's event as before). Adding the new
-- signature beside the old one instead would be an overload, and PostgREST
-- refuses to choose between them (PGRST203) — so the one-argument version
-- is dropped and the two-argument one created in its place, in this same
-- transaction. The default can be removed once nothing passes NULL.
--
-- THE DASHBOARD'S OFFICIAL COUNTS become the event's officials (members in
-- official_events) instead of the tenant's. For that cache_rpc_reader, the
-- role these functions run as, gets SELECT on official_events and the same
-- GUC-scoped read policy every other table it reads has (0049's pattern).
-- Same counts today: every official is in their tenant's only event.
--
-- Return shapes are unchanged; tests/integration asserts them key by key.
--
-- Forward-fix: replace (three RPC signatures and bodies replaced; grant and
--   policy on official_events added)
--   Rollback: drop the (uuid, uuid) versions and restore the (uuid) ones from
--             20261008133456_scheduling_warnings_time_off_clash.sql
--             (dashboard), 20261013093537_event_stages_results_url.sql
--             (event) and 20260930140500_admin_workstations_cached_color.sql
--             (workstations), each with its revoke/grant/owner lines;
--             drop policy if exists cache_rpc_reader_read_official_events on public.official_events;
--             revoke select on public.official_events from cache_rpc_reader;
--   Data:     no data loss. Writes no rows.
--   Blast:    if a body were wrong, EVT-01, the dashboard or WS-01 fails to
--             load (each throws to the admin error boundary); no data is
--             touched. The dashboard's official counts would be wrong if
--             the membership join were.
--   Window:   compatible. Deployed code passes p_tenant_id only, which
--             resolves to the new function with p_event_id NULL — the old
--             behaviour. The return shapes are unchanged.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- cache_rpc_reader reads official_events (dashboard official counts)
-- ----------------------------------------------------------------------------

alter table public.official_events force row level security;

grant select on public.official_events to cache_rpc_reader;

drop policy if exists cache_rpc_reader_read_official_events on public.official_events;
create policy cache_rpc_reader_read_official_events on public.official_events
  for select to cache_rpc_reader
  using (pg_catalog.current_setting('app.tenant_id', true) = tenant_id::text);

-- ----------------------------------------------------------------------------
-- The three RPCs
-- ----------------------------------------------------------------------------

drop function if exists public.get_admin_dashboard_cached(uuid);
drop function if exists public.get_admin_event_cached(uuid);
drop function if exists public.get_admin_workstations_cached(uuid);

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_cached(p_tenant_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and (p_event_id is null or e.id = p_event_id) -- N23
  limit 1;

  if v_event_count > 1 then
    raise exception 'get_admin_dashboard_cached: tenant % has % event rows, expected at most 1',
      p_tenant_id, v_event_count;
  end if;

  select count(*) filter (where o.invite_status = 'invited'),
         count(*) filter (where o.invite_status = 'confirmed')
    into v_officials_invited, v_officials_confirmed
  from public.officials o
  where o.tenant_id = p_tenant_id
    -- N23: the event's officials, not the whole tenant's.
    and (v_event_id is null or exists (
      select 1 from public.official_events oe
      where oe.official_id = o.id and oe.event_id = v_event_id
    ));

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
$function$;

revoke all on function public.get_admin_dashboard_cached(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_admin_dashboard_cached(uuid, uuid) to service_role;
alter function public.get_admin_dashboard_cached(uuid, uuid) owner to cache_rpc_reader;

CREATE OR REPLACE FUNCTION public.get_admin_event_cached(p_tenant_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event_id   uuid;
  v_event      jsonb;
  v_stages     jsonb;
  v_distances  jsonb;
  v_facilities jsonb;
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);

  -- Column list matches the `events` select in admin/event/page.tsx
  -- exactly, including
  -- `id` — the page passes it to the child queries and to the editor form.
  select e.id,
         jsonb_build_object(
           'id', e.id,
           'name', e.name,
           'event_type', e.event_type,
           'description', e.description,
           'location', e.location,
           'logo_url', e.logo_url,
           'status', e.status,
           'scheduling_granularity_min', e.scheduling_granularity_min
         )
    into v_event_id, v_event
  from public.events e
  where e.tenant_id = p_tenant_id
    and (p_event_id is null or e.id = p_event_id) -- N23
  order by e.created_at asc
  limit 1;

  -- Column list matches that page's `event_stages` select. Note
  -- `race_type`, which
  -- get_event_info_cached does not read, and `results_url`, which it does
  -- (migration 20261013093537).
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'stage_type', s.stage_type,
               'race_type', s.race_type,
               'start_time', s.start_time,
               'end_time', s.end_time,
               'venue', s.venue,
               'results_url', s.results_url,
               'position', s.position
             )
             order by s.position asc
           ),
           '[]'::jsonb
         )
    into v_stages
  from public.event_stages s
  where s.event_id = v_event_id
    and s.tenant_id = p_tenant_id;

  -- Column list matches that page's `event_distances` select — no `id`,
  -- as there.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'label', d.label,
               'position', d.position,
               'stage_id', d.stage_id
             )
             order by d.position asc
           ),
           '[]'::jsonb
         )
    into v_distances
  from public.event_distances d
  where d.event_id = v_event_id
    and d.tenant_id = p_tenant_id;

  -- Column list matches that page's `event_facilities` select — `label`
  -- and `position` only,
  -- narrower than get_event_info_cached's, which also returns `id`.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'label', f.label,
               'position', f.position
             )
             order by f.position asc
           ),
           '[]'::jsonb
         )
    into v_facilities
  from public.event_facilities f
  where f.event_id = v_event_id
    and f.tenant_id = p_tenant_id;

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { id, name, event_type, description, location, logo_url,
  --              status, scheduling_granularity_min } | null,
  --     stages:     [ { id, name, stage_type, race_type, start_time,
  --                     end_time, venue, results_url, position } ],
  --     distances:  [ { label, position, stage_id } ],
  --     facilities: [ { label, position } ] }
  -- `event` is JSON null when the tenant has no event row — the page's
  -- notFound() signal. The three arrays are always arrays, never null; when
  -- `event` is null they are empty, since v_event_id is then NULL and every
  -- child predicate fails.
  return jsonb_build_object(
    'event', v_event,
    'stages', v_stages,
    'distances', v_distances,
    'facilities', v_facilities
  );
end;
$function$;

revoke all on function public.get_admin_event_cached(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_admin_event_cached(uuid, uuid) to service_role;
alter function public.get_admin_event_cached(uuid, uuid) owner to cache_rpc_reader;

CREATE OR REPLACE FUNCTION public.get_admin_workstations_cached(p_tenant_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event_id     uuid;
  v_event        jsonb;
  v_stages       jsonb;
  v_workstations jsonb;
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);

  -- The page selects only `id` here and uses it for
  -- the child filters and its notFound() check. Kept as a nested object so
  -- `event: null` stays a distinguishable not-found signal.
  select e.id, jsonb_build_object('id', e.id)
    into v_event_id, v_event
  from public.events e
  where e.tenant_id = p_tenant_id
    and (p_event_id is null or e.id = p_event_id) -- N23
  order by e.created_at asc
  limit 1;

  -- Column list matches that page's `event_stages` select: no venue, no
  -- position, no
  -- race_type — but ordered by position, which the page also does without
  -- selecting it.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'stage_type', s.stage_type,
               'start_time', s.start_time,
               'end_time', s.end_time
             )
             order by s.position asc
           ),
           '[]'::jsonb
         )
    into v_stages
  from public.event_stages s
  where s.event_id = v_event_id
    and s.tenant_id = p_tenant_id;

  -- Reproduces the PostgREST embed in that page. The LATERAL
  -- aggregates each workstation's windows into the nested array PostgREST
  -- would have produced; LEFT JOIN so a workstation with no windows still
  -- appears, with an empty array rather than being dropped.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', w.id,
               'name', w.name,
               'color', w.color,
               'capacity_ceiling', w.capacity_ceiling,
               'stage_id', w.stage_id,
               'workstation_operating_windows', coalesce(ow.windows, '[]'::jsonb)
             )
             order by w.created_at asc
           ),
           '[]'::jsonb
         )
    into v_workstations
  from public.workstations w
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'window_start', o.window_start,
               'window_end', o.window_end
             )
             order by o.window_start asc
           ) as windows
    from public.workstation_operating_windows o
    where o.workstation_id = w.id
  ) ow on true
  where w.event_id = v_event_id
    and w.tenant_id = p_tenant_id;

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { id } | null,
  --     stages: [ { id, name, stage_type, start_time, end_time } ],
  --     workstations: [ { id, name, color, capacity_ceiling, stage_id,
  --                       workstation_operating_windows:
  --                         [ { window_start, window_end } ] } ] }
  -- `event` is JSON null when the tenant has no event row — the page's
  -- notFound() signal. Every array is always an array, never null, including
  -- the nested `workstation_operating_windows`. `color` is JSON null when no
  -- colour has been chosen; the app falls back to hashing the id.
  return jsonb_build_object(
    'event', v_event,
    'stages', v_stages,
    'workstations', v_workstations
  );
end;
$function$;

revoke all on function public.get_admin_workstations_cached(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_admin_workstations_cached(uuid, uuid) to service_role;
alter function public.get_admin_workstations_cached(uuid, uuid) owner to cache_rpc_reader;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with (expect exactly one row each, with two arguments):
--   select p.oid::regprocedure from pg_proc p
--   where p.proname in ('get_admin_dashboard_cached', 'get_admin_event_cached',
--                       'get_admin_workstations_cached');

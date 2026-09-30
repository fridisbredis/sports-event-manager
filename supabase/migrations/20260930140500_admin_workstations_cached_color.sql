-- ============================================================================
-- Migration 20260930140500: get_admin_workstations_cached returns color
-- ============================================================================
--
-- Follows 20260930140000, which added workstations.color. The work-areas list
-- reads through this cached RPC rather than PostgREST, so without this the
-- column is invisible to exactly the screen whose colour dots it controls —
-- the list would keep hashing every id while the detail page and the schedule
-- read the stored value, which is the two-sources-of-truth split the backfill
-- exists to avoid. Same-PR change: the column is inert on WS-01 without it.
--
-- Body is 0053's verbatim except for the one added key in the workstation
-- jsonb (and the shape-contract comment that documents it). Ownership, grants
-- and the `set search_path = ''` hardening are unchanged; `create or replace`
-- keeps them, and they are re-stated below only because 0053 did.
--
-- Forward-fix: replace
--   Rollback: re-apply 0053's function body verbatim in a new timestamped
--             migration (create or replace — the cheap case, same as the
--             20260930085253/0059/0033/0025 precedent).
--   Data:     None. The function only reads; nothing is written or dropped.
--             While reverted, WS-01 falls back to hashing ids for its colour
--             dots, so a work area whose stored colour differs from its hashed
--             one shows the wrong dot on that one screen until re-applied.
--             Cosmetic, and self-correcting on re-apply.
--   Blast:    Scoped to WS-01 (the work-areas list). No other caller.
--   Window:   Compatible in both orders. The deployed app destructures the
--             keys it knows and ignores an extra one, so this is safe to ship
--             before the new code; and the new code treats a missing `color`
--             as null (falling back to the hash), so it is safe to ship after.
-- ============================================================================

create or replace function public.get_admin_workstations_cached(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.get_admin_workstations_cached(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_workstations_cached(uuid) to service_role;

alter function public.get_admin_workstations_cached(uuid) owner to cache_rpc_reader;

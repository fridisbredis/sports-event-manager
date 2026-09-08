-- ============================================================================
-- Migration 0053: get_admin_workstations_cached RPC (PERF-06 / F-PERF-04,
--                 Phase 2)
-- ============================================================================
--
-- Sibling migrations, all in this one PR. If these prefixes shift on
-- rebase, the cross-references below shift with them -- update this key
-- and they all resolve again:
--   0051 event-info  |  0052 admin/event  |  0053 admin/workstations
--
-- Third and last of the Group 1 (tenant-scoped) caching RPCs from ADR-0003.
-- Backs WS-01 (src/app/(tenant)/[tenantSlug]/admin/workstations/page.tsx),
-- which today reads `events` (for the id), `event_stages`, and `workstations`
-- with `workstation_operating_windows` embedded via PostgREST.
--
-- Construction is identical to 0051 and 0052 — SECURITY DEFINER owned by
-- cache_rpc_reader (0049, rolbypassrls = false), search_path = '',
-- transaction-local GUC, grants excluding anon/authenticated. See 0051's
-- header for the full reasoning; it is not repeated here.
--
-- TWO NEW TABLES: `workstations` and `workstation_operating_windows`.
-- `events` and `event_stages` already have their policy, grant and
-- FORCE ROW LEVEL SECURITY from 0051 and are not re-issued here.
--
-- ============================================================================
-- THE ONE POLICY IN THIS PHASE THAT IS NOT A DIRECT GUC COMPARE
-- ============================================================================
--
-- `workstation_operating_windows` is the only one of the six Group 1 tables
-- with NO `tenant_id` column of its own — it carries only `workstation_id`
-- (verified against the live schema: id, workstation_id, window_start,
-- window_end, created_at). Its tenant is reachable only through
-- `workstations`, so its policy must be an EXISTS subquery rather than a
-- column compare.
--
-- The EXISTS *shape* is borrowed from migration 0004's
-- `tenant_member_read_workstation_op_windows`. The *predicate* is NOT.
-- 0004 uses `public.get_user_role(w.tenant_id) is not null`, which cannot
-- work for this role: cache_rpc_reader is NOLOGIN, has no `user_roles` row
-- and no `auth.uid()`, so get_user_role() returns NULL and the policy would
-- deny every row. The page would then cache an empty operating-windows list
-- for the full revalidate window — fail-closed, so not a leak, but a
-- silently wrong page that a "did the call error?" test passes. This is the
-- single most likely place for a future maintainer to "restore consistency"
-- with 0004 and break the feature, which is why it is spelled out here.
--
-- The inner `select 1 from public.workstations w` is itself subject to
-- workstations' own RLS (policies apply inside subqueries too), so the
-- tenant check is enforced twice over: once by workstations'
-- cache_rpc_reader policy filtering the subquery, and once by the explicit
-- GUC compare written below. The explicit compare is kept anyway so the
-- policy reads correctly on its own and stays right even if workstations'
-- policy is ever changed. No recursion risk: workstations' policy does not
-- reference workstation_operating_windows.
--
-- ============================================================================
--
-- NESTED PAYLOAD, NOT A FLAT LIST. The page uses a PostgREST embed
-- (`workstations(... workstation_operating_windows(window_start, window_end))`,
-- page.tsx), which arrives as a nested array on each workstation.
-- PostgREST builds that server-side; inside an RPC this function has to build
-- it, which is what the LEFT JOIN LATERAL below does. The nested key name
-- `workstation_operating_windows` and the element keys `window_start` /
-- `window_end` are a contract with _components/workstations-list.tsx (its
-- OperatingWindow type, its `workstation_operating_windows` field, and
-- its `?? []` read in the list body). Renaming any of
-- them here silently empties the windows column in the UI.
--
-- STAGES ARE A THIRD SHAPE AGAIN: this page reads `id, name, stage_type,
-- start_time, end_time` — no `venue`, no `position`, no `race_type` — while
-- ordering by `position`, which it does not select. So all three Group 1 RPCs
-- return a different `event_stages` shape. Intentional, per the ADR; see
-- 0052's header.
--
-- DETERMINISTIC ORDERING ADDED for the nested windows. The PostgREST embed
-- specifies no order for the nested array, so its order is unspecified today.
-- A cached result must be deterministic — an unspecified order would freeze
-- an arbitrary arrangement into a cache entry for the whole revalidate window
-- and could differ between two identical requests. `order by o.window_start`
-- is therefore a deliberate addition, not a transcription. Same reasoning as
-- the `order by created_at asc limit 1` event pick in 0051.
--
-- CHILD FILTERS: unlike admin/event, this page already filters both child
-- reads by `tenant_id` as well as `event_id`,
-- so the RPC's WHERE clauses match the page exactly here rather than
-- tightening it.
--
-- Same deterministic-event-pick deviation as 0051 and 0052: the page uses
-- `.maybeSingle()` (which errors on more than one row); this RPC uses
-- `order by created_at asc limit 1`.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.get_admin_workstations_cached(uuid);
--             drop policy if exists "cache_rpc_reader_read_workstation_op_windows"
--               on public.workstation_operating_windows;
--             drop policy if exists "cache_rpc_reader_read_workstations" on public.workstations;
--             revoke select on public.workstations,
--               public.workstation_operating_windows from cache_rpc_reader;
--             alter table public.workstation_operating_windows no force row level security;
--             alter table public.workstations no force row level security;
--             (Drop the operating-windows policy BEFORE the workstations one
--             — the former's EXISTS reads the latter's table. Do NOT roll
--             back the events / event_stages policies or grants: 0051 owns
--             those and its own RPC still depends on them.)
--   Data:     No data loss — read-only function, no table contents change.
--   Blast:    None until the app code in this same PR switches
--             admin/workstations/page.tsx to call this RPC. The existing
--             tenant_admin_manage_* / tenant_member_read_* policies from 0004
--             are untouched; this adds two new additive policies scoped
--             `to cache_rpc_reader` only.
--   Window:   Compatible. Old code (still doing the direct session-client
--             reads with the PostgREST embed) is unaffected — this migration
--             only adds objects it does not touch. FORCE ROW LEVEL SECURITY
--             on both tables is a backstop against a future ownership
--             mistake, not load-bearing today: each table's owner is the
--             migration-running role, which has BYPASSRLS in this setup, so
--             the flag changes no behaviour for any role until that invariant
--             is broken.
-- ============================================================================

-- ---- workstations ----
-- Has its own `tenant_id`, so a direct GUC compare, same as 0051's three.
drop policy if exists "cache_rpc_reader_read_workstations" on public.workstations;
create policy "cache_rpc_reader_read_workstations"
  on public.workstations for select
  to cache_rpc_reader
  using (current_setting('app.tenant_id', true) = tenant_id::text);

alter table public.workstations force row level security;

-- ---- workstation_operating_windows ----
-- No tenant_id column; tenant is reachable only through workstations. EXISTS
-- shape from 0004, predicate deliberately NOT 0004's get_user_role() — see
-- the header block above before changing this.
drop policy if exists "cache_rpc_reader_read_workstation_op_windows"
  on public.workstation_operating_windows;
create policy "cache_rpc_reader_read_workstation_op_windows"
  on public.workstation_operating_windows for select
  to cache_rpc_reader
  using (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_id
        and current_setting('app.tenant_id', true) = w.tenant_id::text
    )
  );

alter table public.workstation_operating_windows force row level security;

grant select on public.workstations, public.workstation_operating_windows
  to cache_rpc_reader;

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
  --     workstations: [ { id, name, capacity_ceiling, stage_id,
  --                       workstation_operating_windows:
  --                         [ { window_start, window_end } ] } ] }
  -- `event` is JSON null when the tenant has no event row — the page's
  -- notFound() signal. Every array is always an array, never null, including
  -- the nested `workstation_operating_windows`.
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

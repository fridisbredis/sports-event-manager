-- ============================================================================
-- Migration 0050: get_admin_event_cached RPC (PERF-06 / F-PERF-04, Phase 2)
-- ============================================================================
--
-- Sibling migrations, all in this one PR. If these prefixes shift on
-- rebase, the cross-references below shift with them -- update this key
-- and they all resolve again:
--   0049 event-info  |  0050 admin/event  |  0051 admin/workstations
--
-- Second of the three Group 1 (tenant-scoped) caching RPCs from ADR-0003.
-- Backs EVT-01 (src/app/(tenant)/[tenantSlug]/admin/event/page.tsx), which
-- today issues one `events` read followed by three parallel child reads
-- (`event_stages`, `event_distances`, `event_facilities`).
--
-- Construction is identical to 0049 — SECURITY DEFINER owned by
-- cache_rpc_reader (0047, rolbypassrls = false), search_path = '',
-- transaction-local GUC, grants excluding anon/authenticated. See 0049's
-- header for the full reasoning; it is not repeated here.
--
-- ONLY ONE NEW TABLE. `events`, `event_stages` and `event_facilities`
-- already have their cache_rpc_reader policy, their SELECT grant and their
-- FORCE ROW LEVEL SECURITY flag from 0049 — this migration adds those three
-- things for `event_distances` only, and reuses the rest. Migrations are
-- strictly ordered, so 0049's objects are in place by the time this runs.
-- Do not re-issue them here: a second `create policy` with the same name on
-- the same table would fail, and the `drop policy if exists` needed to make
-- it re-runnable would briefly remove a policy 0049 owns.
--
-- WIDER COLUMN LISTS THAN 0049, DELIBERATELY. This page is the editor, not
-- the read-only official view, so it reads more of each row than
-- `get_event_info_cached` does:
--   events        + id, location, scheduling_granularity_min
--   event_stages  + race_type
--   event_distances (0049 does not read this table at all)
--   event_facilities  label, position only — no id, unlike 0049
-- The two RPCs therefore return different shapes for the same tables. That
-- is the ADR's "cost is paid once per data shape, not once per call site"
-- working as intended, not duplication to be collapsed. A
-- future refactor that merges them must keep every key both callers read.
--
-- CHILD FILTERS: the page filters the three child reads by `event_id` ONLY,
-- with no `tenant_id` predicate — safe there
-- because the session-cookie client's RLS scopes by tenant. Inside this RPC
-- the cache_rpc_reader policy is the only thing that would scope them, so
-- every child query below filters on BOTH `event_id` and `tenant_id`. Same
-- defense-in-depth stance as 0049: the WHERE clause is not the security
-- boundary, but it is what survives a mis-edited policy.
--
-- Empirically verified against the local stack for 0049's equivalent
-- policies, and the check applies unchanged here: with the GUC set and NO
-- WHERE clause at all, cache_rpc_reader sees exactly one tenant's rows; with
-- the GUC unset it sees zero. The policy is load-bearing, not decorative.
--
-- Same deterministic-event-pick deviation as 0049: the page uses
-- `.maybeSingle()` (which errors on more than one row); this RPC uses
-- `order by created_at asc limit 1`. See 0049's header for why a
-- deterministic pick is required once the result is cached.
--
-- The page calls `notFound()` when the `events` read returns nothing, so
-- `event: null` in this payload is the caller's not-found signal — it must
-- stay a distinguishable null rather than becoming an empty object.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.get_admin_event_cached(uuid);
--             drop policy if exists "cache_rpc_reader_read_event_distances" on public.event_distances;
--             revoke select on public.event_distances from cache_rpc_reader;
--             alter table public.event_distances no force row level security;
--             (Do NOT roll back the events / event_stages / event_facilities
--             policies or grants — 0049 owns those, and 0049's own RPC and
--             0051 still depend on them.)
--   Data:     No data loss — read-only function, no table contents change.
--   Blast:    None until the app code in this same PR switches
--             admin/event/page.tsx to call this RPC. The existing
--             tenant_admin_manage_event_distances /
--             tenant_member_read_event_distances policies from 0005 are
--             untouched; this adds one new additive policy scoped
--             `to cache_rpc_reader` only.
--   Window:   Compatible. Old code (still doing the four direct
--             session-client reads) is unaffected — this migration only adds
--             objects it does not touch. FORCE ROW LEVEL SECURITY on
--             event_distances is a backstop against a future ownership
--             mistake, not load-bearing today: the table's owner is the
--             migration-running role, which has BYPASSRLS in this setup, so
--             the flag changes no behaviour for any role until that
--             invariant is broken.
-- ============================================================================

-- ---- event_distances ----
-- The only table this migration adds. Has its own `tenant_id`, so the
-- predicate is a direct GUC compare — NOT migration 0004's
-- `get_user_role(tenant_id)` style, which returns NULL for a NOLOGIN role
-- with no user_roles row and would deny every row (see 0049's header).
drop policy if exists "cache_rpc_reader_read_event_distances" on public.event_distances;
create policy "cache_rpc_reader_read_event_distances"
  on public.event_distances for select
  to cache_rpc_reader
  using (current_setting('app.tenant_id', true) = tenant_id::text);

alter table public.event_distances force row level security;

grant select on public.event_distances to cache_rpc_reader;

create or replace function public.get_admin_event_cached(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  order by e.created_at asc
  limit 1;

  -- Column list matches that page's `event_stages` select. Note
  -- `race_type`, which
  -- get_event_info_cached does not read.
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
  --                     end_time, venue, position } ],
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
$$;

revoke all on function public.get_admin_event_cached(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_event_cached(uuid) to service_role;

alter function public.get_admin_event_cached(uuid) owner to cache_rpc_reader;

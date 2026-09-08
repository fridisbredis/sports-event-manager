-- ============================================================================
-- Migration 0051: get_event_info_cached RPC (PERF-06 / F-PERF-04, Phase 2)
-- ============================================================================
--
-- Sibling migrations, all in this one PR. If these prefixes shift on
-- rebase, the cross-references below shift with them -- update this key
-- and they all resolve again:
--   0051 event-info  |  0052 admin/event  |  0053 admin/workstations
--
-- First of the three Group 1 (tenant-scoped) caching RPCs from ADR-0003
-- (docs/adr/0003-caching-position-for-read-heavy-pages.md, PR #129 — still
-- Proposed at time of writing). Backs INFO-01
-- (src/app/(official)/[tenantSlug]/event-info/page.tsx), which today issues
-- three parallel session-client reads: `events` (one row, tenant-filtered),
-- `event_stages`, and `event_facilities` (both tenant-filtered, ordered by
-- `position`).
--
-- Same fail-closed construction as the Phase 1 pilot (0050), for the same
-- reason: `unstable_cache` cannot read `cookies()`, so the cached function
-- must call this RPC through the service-role client — and service_role has
-- rolbypassrls = true in this Supabase setup, so a plain RPC would skip RLS
-- entirely. This function is SECURITY DEFINER owned by cache_rpc_reader
-- (0049, rolbypassrls = false), so RLS is evaluated against that
-- low-privilege owner no matter which client calls it.
--
-- THREE tables, not two. The ADR's own per-page shape summary describes
-- event-info as "a read-only subset of `events` plus `event_facilities`"
-- and omits `event_stages`, but the page does read it. `event_stages` is in
-- fact read by all three Group 1 pages, so its policy and grant land here,
-- in the first migration of the group, and 0052/0053 reuse them rather than
-- re-issuing. Likewise `event_facilities`, which admin/event also reads.
--
-- POLICY PREDICATE — do not "fix" these to match migration 0004. All three
-- tables here carry their own `tenant_id`, so each policy compares the
-- transaction-local `app.tenant_id` GUC directly against that column.
-- 0004's convention (`get_user_role(tenant_id) is not null`) CANNOT be used
-- for this role: cache_rpc_reader is NOLOGIN, has no `user_roles` row and no
-- `auth.uid()`, so `get_user_role()` returns NULL for it and a copied policy
-- would deny every row — leaving the page to cache an empty payload for the
-- full revalidate window. Fail-closed, so not a leak, but a silently broken
-- page that a "did the call error?" test passes. The `to cache_rpc_reader`
-- clause is what keeps these policies from widening anything for any other
-- role, including anon.
--
-- The RPC body also filters `tenant_id = p_tenant_id` in every WHERE clause,
-- duplicating what the policies already enforce. That redundancy is
-- deliberate: it is the only tenant scoping that survives if a policy is
-- ever edited wrong, and it keeps the body readable as tenant-scoped on its
-- own terms.
--
-- GUC is set with the third argument literally `true` (transaction-local),
-- per ADR rule 5 — a `false` or omitted third argument makes it
-- session-scoped, which on a pooled PostgREST/Supavisor connection survives
-- into later unrelated requests and misapplies tenant scoping there. This
-- migration additionally resets the GUC to '' before returning: `set_config`
-- with is_local => true reverts at end of *transaction*, not end of
-- function (unlike the function-level `set search_path`, which is restored
-- on exit), so without the reset the value outlives the function body inside
-- its own transaction. Nothing else runs in that transaction today, so this
-- is hardening, not a bug fix. A CI guard in this same PR rejects any future
-- migration whose `set_config('app.…` third argument is not `true`.
--
-- search_path = '' with every non-pg_catalog reference schema-qualified,
-- matching 0050 (and deliberately NOT the `set search_path = public` used by
-- this project's older SECURITY DEFINER functions — see 0050's header for
-- why that divergence is intentional). `jsonb_build_object`, `jsonb_agg` and
-- `coalesce` are pg_catalog and resolve regardless of search_path.
--
-- Per this project's RPC guard convention (grants control callability, not
-- Zod): the two-statement revoke/grant form from 0026 and 0050 — revoke from
-- public + anon + authenticated, then grant to service_role. A bare
-- `revoke ... from public` would leave Supabase's automatic per-role grants
-- in place, the exact gap that previously re-exposed check_rate_limit,
-- get_last_sign_in_at, anonymize_inactive_users and claim_sms_queue_batch.
--
-- Ownership reassignment relies on the two grants 0050 already issued
-- (`grant cache_rpc_reader to postgres`, `grant create on schema public to
-- cache_rpc_reader`). Migrations are strictly ordered, so they are in place
-- by the time this runs; they are not re-issued here.
--
-- ONE DELIBERATE BEHAVIOUR CHANGE: the page's `events` read uses PostgREST
-- `.maybeSingle()`, which raises an error if more than one row matches. This
-- RPC uses `order by created_at asc limit 1` instead, which would silently
-- pick the oldest. The app's invariant is one event per tenant (admin/event
-- and admin/workstations both use `.maybeSingle()` on the same filter), so
-- the two agree in practice — but a deterministic pick is required here,
-- because a non-deterministic one gets frozen into a cache entry for the
-- whole revalidate window. Flagged rather than left for a reviewer to spot.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.get_event_info_cached(uuid);
--             drop policy if exists "cache_rpc_reader_read_events" on public.events;
--             drop policy if exists "cache_rpc_reader_read_event_stages" on public.event_stages;
--             drop policy if exists "cache_rpc_reader_read_event_facilities" on public.event_facilities;
--             revoke select on public.events, public.event_stages,
--               public.event_facilities from cache_rpc_reader;
--             alter table public.events no force row level security;
--             alter table public.event_stages no force row level security;
--             alter table public.event_facilities no force row level security;
--             (0052 and 0053 depend on the event_stages / event_facilities
--             policies and grants — if either has already been applied, roll
--             those back first or this rollback breaks their RPCs.)
--   Data:     No data loss — read-only function, no table contents change.
--   Blast:    None until the app code in this same PR switches
--             event-info/page.tsx to call this RPC. The existing
--             tenant_admin_manage_* / tenant_member_read_* policies from
--             0004 and 0005 are untouched; this adds three new additive
--             policies scoped `to cache_rpc_reader` only, a role no other
--             policy has ever been evaluated against.
--   Window:   Compatible. Old code (still doing the three direct
--             session-client reads) is unaffected — this migration only adds
--             objects it does not touch. FORCE ROW LEVEL SECURITY on the
--             three tables is a backstop against a future ownership mistake
--             (per the ADR), not load-bearing today: each table's owner is
--             the migration-running role, which has BYPASSRLS in this setup,
--             so the flag changes no behaviour for any role until that
--             invariant is broken.
-- ============================================================================

-- ---- events ----
drop policy if exists "cache_rpc_reader_read_events" on public.events;
create policy "cache_rpc_reader_read_events"
  on public.events for select
  to cache_rpc_reader
  using (current_setting('app.tenant_id', true) = tenant_id::text);

alter table public.events force row level security;

-- ---- event_stages ----
-- Read by all three Group 1 pages (event-info, admin/event,
-- admin/workstations). Added once, here; 0052 and 0053 reuse it.
drop policy if exists "cache_rpc_reader_read_event_stages" on public.event_stages;
create policy "cache_rpc_reader_read_event_stages"
  on public.event_stages for select
  to cache_rpc_reader
  using (current_setting('app.tenant_id', true) = tenant_id::text);

alter table public.event_stages force row level security;

-- ---- event_facilities ----
-- Read by event-info and admin/event. Added once, here; 0052 reuses it.
drop policy if exists "cache_rpc_reader_read_event_facilities" on public.event_facilities;
create policy "cache_rpc_reader_read_event_facilities"
  on public.event_facilities for select
  to cache_rpc_reader
  using (current_setting('app.tenant_id', true) = tenant_id::text);

alter table public.event_facilities force row level security;

grant select on public.events, public.event_stages, public.event_facilities
  to cache_rpc_reader;

create or replace function public.get_event_info_cached(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event      jsonb;
  v_stages     jsonb;
  v_facilities jsonb;
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);

  -- Column list matches the `events` select in event-info/page.tsx exactly.
  select jsonb_build_object(
           'name', e.name,
           'event_type', e.event_type,
           'description', e.description,
           'logo_url', e.logo_url,
           'status', e.status
         )
    into v_event
  from public.events e
  where e.tenant_id = p_tenant_id
  order by e.created_at asc
  limit 1;

  -- Column list matches that page's `event_stages` select; ordered by
  -- position, as there.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'stage_type', s.stage_type,
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
  where s.tenant_id = p_tenant_id;

  -- Column list matches that page's `event_facilities` select; ordered by
  -- position, as there.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', f.id,
               'label', f.label,
               'position', f.position
             )
             order by f.position asc
           ),
           '[]'::jsonb
         )
    into v_facilities
  from public.event_facilities f
  where f.tenant_id = p_tenant_id;

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { name, event_type, description, logo_url, status } | null,
  --     stages:     [ { id, name, stage_type, start_time, end_time, venue, position } ],
  --     facilities: [ { id, label, position } ] }
  -- `event` is JSON null when the tenant has no event row; the two arrays
  -- are always arrays, never null.
  return jsonb_build_object(
    'event', v_event,
    'stages', v_stages,
    'facilities', v_facilities
  );
end;
$$;

revoke all on function public.get_event_info_cached(uuid) from public, anon, authenticated;
grant execute on function public.get_event_info_cached(uuid) to service_role;

alter function public.get_event_info_cached(uuid) owner to cache_rpc_reader;

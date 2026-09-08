-- ============================================================================
-- Migration 0055: fix overlapping cache_rpc_reader policies on officials
--                 (PERF-06 / F-PERF-04, Phase 5)
-- ============================================================================
--
-- Fixes a defect introduced within PERF-06's own branch, between 0050 and
-- 0054.
--
-- 0050 added `cache_rpc_reader_read_own_officials` on public.officials:
--   (app.tenant_id = tenant_id) AND (app.user_id = user_id)
-- That own-row half is the whole point of the HOME-01 pilot — the ADR
-- flagged the own-row shape as the case its tenant-only precedent had never
-- exercised, and 0050's header names it as the fail-closed backstop behind
-- get_official_home_cached.
--
-- 0054 then added `cache_rpc_reader_read_officials` on the SAME table, for
-- the SAME role, for the SAME command, with a tenant-only predicate, because
-- get_admin_dashboard_cached legitimately needs every official in the tenant
-- to compute its invited/confirmed head-counts.
--
-- Two PERMISSIVE policies on one (table, role, command) are combined with
-- OR, not AND. The effective predicate therefore collapsed to:
--   ((tenant AND user) OR tenant)  ==  tenant
-- and the own-row guarantee 0050 exists to provide was silently gone from
-- the moment 0054 landed.
--
-- No data ever leaked: get_official_home_cached's body still filters
-- `user_id = p_user_id`, exactly the belt-and-braces redundancy 0051's
-- header argues for. What was lost is the backstop — the thing that is
-- supposed to hold if that WHERE clause is ever edited wrong. Verified
-- empirically against the local stack before writing this migration:
-- `set role cache_rpc_reader` with app.user_id set to official A returned
-- both A and B; after this migration it returns A alone.
--
-- STILL NOT COVERED BY A TEST. tests/integration/get-official-home-cached.
-- test.ts has a "does not leak another user's row" case and it passed
-- throughout the whole time the policy was broken — because it calls the RPC,
-- and the RPC's own WHERE clause masks the policy. Reaching the boundary
-- means querying the table as `cache_rpc_reader` directly, which PostgREST
-- cannot do and the Supabase JS client has no route to. So this class of
-- defect is currently caught by review only. Worth revisiting if a second
-- named-role policy set is ever added.
--
-- THE FIX: one policy, not two, whose scope narrows when app.user_id is set.
--   - app.user_id set     -> own-row (HOME-01's get_official_home_cached,
--                            which already sets both GUCs — 0050 unchanged)
--   - app.user_id unset   -> tenant-wide (get_admin_dashboard_cached)
--   - app.tenant_id unset -> nothing at all; `NULL = text` is NULL, not true
-- `nullif(..., '')` rather than a bare NULL check because set_config(name,
-- '', true) — the reset form used at the end of every cache RPC — leaves the
-- empty string, not NULL. Both spellings of "not set" must mean the same
-- thing here or the reset itself would silently widen the policy.
--
-- WHY get_admin_dashboard_cached IS REPLACED TOO. The predicate above now
-- depends on app.user_id, a dependency this migration introduces. 0054's
-- body never mentions that GUC, so under the new policy a leftover value
-- would silently restrict its head-counts to a single official — wrong
-- numbers, no error. It now clears app.user_id on entry. Today each RPC is
-- its own PostgREST transaction so a leftover cannot actually occur; this is
-- what keeps that from being load-bearing. Nothing else in the body changes.
--
-- The body is otherwise carried over from 0054 UNCHANGED, including every
-- jsonb key. Per this project's RPC return-shape rule (F-REL-16, and the
-- 0045/0046 `role_granted` regression that produced it), the call site was
-- re-checked before writing this: admin/dashboard/page.tsx destructures
-- event, officials_invited, officials_confirmed, race_stage_count,
-- over_capacity, double_booked, earliest_day, earliest_stage_id. The
-- existing integration test asserts those keys against real Postgres and
-- must stay green.
--
-- Forward-fix: replace
--   Rollback: The two policies and the function definition are restorable
--             verbatim from migrations 0050 and 0054 (the function uses
--             `create or replace`, so no drop is needed):
--               drop policy if exists "cache_rpc_reader_read_officials" on public.officials;
--               (then re-run the policy block from 0050 and the one from 0054,
--                and the get_admin_dashboard_cached body from 0054)
--             Doing so REINSTATES the defect this migration fixes. The
--             correct backward step, if a caller regresses, is to keep this
--             policy and fix that caller's GUCs instead.
--   Data:     No data loss. One policy and one function definition; no table
--             contents are read, written, or destroyed by this migration.
--   Blast:    If the composed predicate were wrong, HOME-01's greeting name
--             or the admin dashboard's officials head-counts would come back
--             empty/zero — fail-closed and visible, not a leak. Both are
--             covered by the existing integration tests.
--   Window:   Compatible, in both directions. The currently deployed code
--             calls both RPCs by the same names with the same arguments and
--             reads the same keys out of the same jsonb shapes, so it is
--             unaffected while this schema is live ahead of the image. The
--             policy change cannot widen anything for any other role — it is
--             scoped `to cache_rpc_reader`, which nothing but these
--             SECURITY DEFINER functions ever runs as.
-- ============================================================================

-- ---- officials: one policy, scope narrows when app.user_id is set ----
drop policy if exists "cache_rpc_reader_read_own_officials" on public.officials;
drop policy if exists "cache_rpc_reader_read_officials" on public.officials;

create policy "cache_rpc_reader_read_officials"
  on public.officials for select
  to cache_rpc_reader
  using (
    current_setting('app.tenant_id', true) = tenant_id::text
    and (
      nullif(current_setting('app.user_id', true), '') is null
      or current_setting('app.user_id', true) = user_id::text
    )
  );

-- ---- admin dashboard: state the tenant-wide scope instead of inheriting it -
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
  -- Tenant-wide scope on officials is this function's whole purpose: the
  -- head-counts below are over every official in the tenant. Stated, not
  -- inherited — see this migration's header.
  perform pg_catalog.set_config('app.user_id', '', true);

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
  -- come back 0/NULL as appropriate. See 0054's header note.
  select *
    into v_warnings
  from public.scheduling_warning_counts(p_tenant_id, v_event_id);

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract unchanged from 0054 (asserted key-by-key in the
  -- integration test, since `supabase gen types` cannot see inside a jsonb
  -- return — F-REL-16):
  --   { event: { id, name, event_type, start_date, end_date, status,
  --              scheduling_granularity_min, logo_url } | null,
  --     officials_invited: number,
  --     officials_confirmed: number,
  --     race_stage_count: number,
  --     over_capacity: number,
  --     double_booked: number,
  --     earliest_day: string | null,
  --     earliest_stage_id: string | null }
  return jsonb_build_object(
    'event', v_event,
    'officials_invited', coalesce(v_officials_invited, 0),
    'officials_confirmed', coalesce(v_officials_confirmed, 0),
    'race_stage_count', coalesce(v_race_stage_count, 0),
    'over_capacity', coalesce(v_warnings.over_capacity, 0),
    'double_booked', coalesce(v_warnings.double_booked, 0),
    'earliest_day', v_warnings.earliest_day,
    'earliest_stage_id', v_warnings.earliest_stage_id
  );
end;
$$;

-- `create or replace` preserves the existing owner, so the function stays
-- owned by cache_rpc_reader (the NOBYPASSRLS role from 0049) and keeps the
-- ACL 0054 set. Re-asserted anyway: the whole design collapses to a
-- cross-tenant leak if it is ever owned by a BYPASSRLS role, and this is the
-- one line that makes that impossible to get wrong by omission.
alter function public.get_admin_dashboard_cached(uuid) owner to cache_rpc_reader;

-- ============================================================================
-- Migration 0052: get_admin_dashboard_cached RPC (PERF-06 / F-PERF-04, Phase 3)
-- ============================================================================
--
-- Backs the tenant admin dashboard
-- (src/app/(tenant)/[tenantSlug]/admin/dashboard/page.tsx), which today issues
-- three parallel session-client reads (`events`, two `officials` head-counts)
-- followed by a dependent `event_stages` head-count and a call to the
-- existing `scheduling_warning_counts` RPC (migration 0040).
--
-- WIDER SURFACE THAN GROUP 1: unlike event-info/admin-event/admin-workstations
-- (Group 1, migrations 0049-0051), which each read only their own event
-- sub-tables, this page also reads `officials` (two count aggregates) and,
-- transitively through scheduling_warning_counts, `assignments` and
-- `workstations`. `workstations` already has a cache_rpc_reader policy from
-- 0051 and is reused unchanged; `officials` and `assignments` are new here.
--
-- Same fail-closed construction as 0048-0051: SECURITY DEFINER owned by
-- cache_rpc_reader (0047, rolbypassrls = false), search_path = '', every
-- non-pg_catalog reference schema-qualified, transaction-local GUC (third
-- `set_config` argument literally `true`, reset to '' before returning),
-- grants excluding anon/authenticated. See 0049's header for the full
-- reasoning; not repeated here.
--
-- POLICY PREDICATE — `officials` and `assignments` both carry their own
-- `tenant_id`, so both new policies compare the transaction-local
-- `app.tenant_id` GUC directly against that column, same as every Group 1
-- policy. Migration 0004's `get_user_role(tenant_id)` convention still
-- cannot be used for this role (cache_rpc_reader is NOLOGIN, no
-- `user_roles` row, `get_user_role()` returns NULL for it, denying every
-- row).
--
-- REUSING scheduling_warning_counts RATHER THAN DUPLICATING IT: this
-- function calls the existing `public.scheduling_warning_counts(uuid, uuid)`
-- (0040) instead of re-implementing its over-capacity/double-booking CTEs.
-- That function is `security invoker`, `language sql` — invoker semantics
-- mean it runs as whichever role is current_user at the call site. Because
-- this wrapping function is itself SECURITY DEFINER, current_user during its
-- body (and so during the nested call) is the definer, cache_rpc_reader —
-- not the original caller (service_role). Two consequences, both handled
-- below:
--   1. RLS on `assignments`/`workstations` inside the nested call evaluates
--      against cache_rpc_reader, same as every other table this RPC reads
--      directly — hence the new `assignments` policy.
--   2. EXECUTE privilege on scheduling_warning_counts is checked against
--      cache_rpc_reader too, not against whatever role ends up calling this
--      wrapper. 0040 only granted EXECUTE to `authenticated`, which
--      cache_rpc_reader is not — so this migration adds a second EXECUTE
--      grant on scheduling_warning_counts, to cache_rpc_reader. Without it,
--      every call to get_admin_dashboard_cached fails with
--      "permission denied for function scheduling_warning_counts", not a
--      silent empty result — verified against the local stack below.
--
-- NO EVENT-EXISTENCE BRANCH NEEDED for the warning counts: when the tenant
-- has no event, v_event_id is NULL, and scheduling_warning_counts's own
-- joins (`w.event_id = p_event_id`) can never match a NULL, so every count
-- comes back 0 and every earliest_* column comes back NULL — exactly the
-- zero-defaults the page's `if (event) {...}` branch produces today. Calling
-- it unconditionally is simpler than branching and produces the same result.
--
-- OFFICIALS COUNTS: `count(*) filter (where invite_status = ...)` in one
-- query rather than the page's two separate head-count queries — cheaper
-- (one table scan instead of two) and the two counts are otherwise
-- independent, exactly the kind of merge the ADR's "cost is paid once per
-- data shape" intent covers.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.get_admin_dashboard_cached(uuid);
--             drop policy if exists "cache_rpc_reader_read_officials" on public.officials;
--             drop policy if exists "cache_rpc_reader_read_assignments" on public.assignments;
--             revoke select on public.officials, public.assignments from cache_rpc_reader;
--             revoke execute on function public.scheduling_warning_counts(uuid, uuid) from cache_rpc_reader;
--             alter table public.officials no force row level security;
--             alter table public.assignments no force row level security;
--             (Do NOT touch the `workstations` policy/grant/force-RLS from
--             0051 — that migration owns it and 0051's own RPC still depends
--             on it.)
--   Data:     No data loss — read-only function, no table contents change.
--   Blast:    None until the app code in this same PR switches
--             admin/dashboard/page.tsx to call this RPC. The existing
--             tenant_admin_manage_officials / tenant_member_read_officials
--             (0004) and tenant_admin_manage_assignments /
--             tenant_member_read_assignments policies are untouched; this
--             adds two new additive policies scoped `to cache_rpc_reader`
--             only, plus one additive EXECUTE grant on an existing function.
--   Window:   Compatible. Old code (still doing the direct session-client
--             reads and the direct scheduling_warning_counts call under the
--             caller's own session) is unaffected — this migration only adds
--             objects/grants it does not remove anything from. FORCE ROW
--             LEVEL SECURITY on officials/assignments is a backstop against a
--             future ownership mistake (per the ADR), not load-bearing
--             today: each table's owner is the migration-running role, which
--             has BYPASSRLS in this setup, so the flag changes no behaviour
--             for any role until that invariant is broken.
-- ============================================================================

-- ---- officials ----
drop policy if exists "cache_rpc_reader_read_officials" on public.officials;
create policy "cache_rpc_reader_read_officials"
  on public.officials for select
  to cache_rpc_reader
  using (current_setting('app.tenant_id', true) = tenant_id::text);

alter table public.officials force row level security;

grant select on public.officials to cache_rpc_reader;

-- ---- assignments ----
-- Read transitively via scheduling_warning_counts, not directly by this
-- function's own body — but SECURITY DEFINER means the nested call's RLS
-- evaluates against this function's owner, so the grant/policy still has to
-- live here.
drop policy if exists "cache_rpc_reader_read_assignments" on public.assignments;
create policy "cache_rpc_reader_read_assignments"
  on public.assignments for select
  to cache_rpc_reader
  using (current_setting('app.tenant_id', true) = tenant_id::text);

alter table public.assignments force row level security;

grant select on public.assignments to cache_rpc_reader;

-- `workstations` already has a cache_rpc_reader select policy and FORCE RLS
-- from migration 0051 — reused unchanged, not reissued here.

grant execute on function public.scheduling_warning_counts(uuid, uuid) to cache_rpc_reader;

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
    'earliest_day', v_warnings.earliest_day,
    'earliest_stage_id', v_warnings.earliest_stage_id
  );
end;
$$;

revoke all on function public.get_admin_dashboard_cached(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_dashboard_cached(uuid) to service_role;

alter function public.get_admin_dashboard_cached(uuid) owner to cache_rpc_reader;

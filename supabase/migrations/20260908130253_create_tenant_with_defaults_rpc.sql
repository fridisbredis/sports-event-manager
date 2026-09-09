-- ============================================================================
-- Migration 20260908130253: create_tenant_with_defaults RPC
-- ============================================================================
--
-- REL-01: createTenant() in src/app/(system)/admin/actions.ts performed
-- three independent writes with no transaction: insert tenants, insert
-- events, insert event_stages (Setup/Race/Teardown). A failure on the third
-- step (e.g. a constraint violation) left an orphaned tenant with no
-- default event or stages behind, invisible to any unit test mocking the
-- Supabase client per call — the same class of bug fixed ad-hoc by
-- remove_official (0025) and create_workstation (0031/0059).
--
-- This RPC wraps all three in a single transaction: a failure on any step
-- rolls back the whole tenant creation rather than leaving a partial result.
-- See docs/patterns/atomic-multi-table-writes.md for when this pattern
-- applies generally.
--
-- SECURITY INVOKER, matching remove_official's reasoning: the caller is
-- already verified as system_admin by assertSystemAdmin() before this RPC
-- is called (session client, not service client). RLS already gates every
-- statement in this body for exactly this caller:
--   - tenants: "system_admin_all_tenants" (FOR ALL USING is_system_admin())
--     from migration 0002 — no WITH CHECK means USING also governs INSERT.
--   - events / event_stages: tenant_admin_manage_events /
--     tenant_admin_manage_event_stages (migration 0004), both
--     `... OR is_system_admin()` — is_system_admin() does not depend on
--     tenant_id, so it holds immediately for a brand-new tenant with no
--     user_roles row yet. Running as invoker keeps RLS as the only gate
--     inside the function body rather than bypassing it.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.create_tenant_with_defaults(text, text);
--   Data:     no data loss — this only adds a new function, no existing
--             table or row is touched.
--   Blast:    none until the app is changed to call it; the old three-insert
--             code path in createTenant() keeps working unmodified until
--             that follow-up change lands.
--   Window:   compatible — additive, no schema old code depends on changes.
-- ============================================================================

create or replace function public.create_tenant_with_defaults(
  p_name text,
  p_slug text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_event_id  uuid;
begin
  insert into tenants (name, slug, is_active, tier, feature_flags)
  values (p_name, p_slug, true, 'standard', '{}'::jsonb)
  returning id into v_tenant_id;

  insert into events (tenant_id, name, event_type, status, scheduling_granularity_min)
  values (v_tenant_id, p_name, 'Event', 'draft', 60)
  returning id into v_event_id;

  insert into event_stages (event_id, tenant_id, name, stage_type, race_type, position)
  values
    (v_event_id, v_tenant_id, 'Setup', 'non_race', 'distance', 0),
    (v_event_id, v_tenant_id, 'Race', 'race', 'distance', 1),
    (v_event_id, v_tenant_id, 'Teardown', 'non_race', 'distance', 2);

  return jsonb_build_object('tenant_id', v_tenant_id, 'event_id', v_event_id);
end;
$$;

comment on function public.create_tenant_with_defaults is
  'REL-01: atomically creates a tenant with its default event and three '
  'default stages (Setup/Race/Teardown), all in one transaction. SECURITY '
  'INVOKER: relies on the caller''s own RLS grants (system_admin_all_tenants '
  'from migration 0002, tenant_admin_manage_events/event_stages from '
  'migration 0004), not on bypassing them. A unique-slug violation (23505) '
  'propagates to the caller unchanged, same as the prior direct insert.';

-- SECURITY INVOKER function, so no explicit grant to service_role is
-- needed. Revoke the default PUBLIC execute grant and grant to
-- authenticated explicitly, so RLS inside the function body is the only
-- gate, not "can call the function at all".
revoke all on function public.create_tenant_with_defaults(text, text) from public;
grant execute on function public.create_tenant_with_defaults(text, text) to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'create_tenant_with_defaults';

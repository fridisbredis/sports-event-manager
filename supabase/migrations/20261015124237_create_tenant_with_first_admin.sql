-- ============================================================================
-- Migration 20261015124237: create a tenant together with its first admin
-- ============================================================================
--
-- N20, second half. 20261015122314 made it possible to add an admin to an
-- existing tenant; this closes the gap that made that necessary in the first
-- place. SYS-01 still produced a tenant with no admin row, so every new tenant
-- was unreachable until someone remembered to go to SYS-02 — which is how
-- "Micke testar" and "Eddo testar" ended up with zero admins in prod.
--
-- TWO FIXES IN ONE MIGRATION, BOTH ABOUT THE SAME FUNCTIONS
--
-- 1. create_tenant_with_defaults gains the first admin, in the same
--    transaction as the tenant, its event and its stages. Partial success here
--    is exactly the REL-01 failure mode the RPC was written for: a tenant that
--    exists but cannot be entered is worse than no tenant at all.
--
-- 2. SECURITY FIX on the two RPCs added by 20261015122314. That migration
--    revoked them `from public` only. Postgres' PUBLIC grant is not the only
--    one in play: Supabase ships a default ACL on schema public that grants
--    EXECUTE on every new function to `anon` and `authenticated` explicitly,
--    and an explicit grant survives a revoke from PUBLIC. Verified on the
--    local database after that migration ran:
--      grant_tenant_admin | anon=X/postgres | authenticated=X/postgres
--    So any holder of the anon key could call grant_tenant_admin and make
--    themselves tenant_admin of any tenant. ensure_admin_roster_row
--    (20260911130436) got this right with three separate revokes; this
--    migration copies that, for both new functions and for the amended
--    create_tenant_with_defaults.
--
-- WHY create_tenant_with_defaults BECOMES SECURITY DEFINER
-- It was INVOKER, relying on the caller's own RLS grants. It cannot stay that
-- way once it writes user_roles: no RLS policy lets `authenticated` insert
-- there (deliberately — that is the privilege table), and
-- ensure_admin_roster_row, which it now calls, is DEFINER and reads
-- auth.users. The guard that replaces RLS is the same one ensure_admin_roster_row
-- uses: the body verifies the caller is a system_admin, and the function is
-- granted to service_role only.
--
-- The first admin is OPTIONAL (p_admin_user_id defaults to null) so the RPC
-- keeps working for callers that do not pass one — the existing unit and
-- integration tests, scripts/seed-dev.ts, and any flow that wants a tenant
-- shell. A tenant created without an admin is still reachable via SYS-02.
--
-- Forward-fix: replace
--   Rollback: restore the previous body from 20260908130253 (which is
--             self-contained: it takes p_name, p_slug only, is SECURITY
--             INVOKER, and grants execute to `authenticated`). Then
--               drop function if exists
--                 public.create_tenant_with_defaults(text, text, uuid, text);
--             to remove this four-argument overload. Note the signature
--             change: this creates a NEW overload rather than replacing the
--             old one, so both exist until that drop runs. The app calls the
--             four-argument form.
--   Data:     no data loss. Tenants already created keep their rows; this
--             changes only what future calls do.
--   Blast:    the old two-argument function is left in place and keeps
--             working, so a deploy that lands this before the app change is
--             a no-op. The security revokes take effect immediately and are
--             the one part that should NOT wait: they close an open hole.
--   Window:   compatible — the old signature survives, so currently-deployed
--             code is unaffected.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Security fix for 20261015122314's two functions.
-- ---------------------------------------------------------------------------
-- `from public` alone left Supabase's explicit anon/authenticated grants in
-- place. Revoking from each role by name is what actually closes it.
revoke all on function public.grant_tenant_admin(uuid, uuid) from anon;
revoke all on function public.grant_tenant_admin(uuid, uuid) from authenticated;
revoke all on function public.revoke_tenant_admin(uuid, uuid) from anon;
revoke all on function public.revoke_tenant_admin(uuid, uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 2. create_tenant_with_defaults, now with an optional first admin.
-- ---------------------------------------------------------------------------
create or replace function public.create_tenant_with_defaults(
  p_name            text,
  p_slug            text,
  p_admin_user_id   uuid default null,
  p_admin_name      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_event_id  uuid;
  v_admin     jsonb := null;
begin
  -- The security boundary. Was RLS under SECURITY INVOKER; DEFINER means this
  -- body is its own gate, so the system_admin check is explicit. Mirrors
  -- ensure_admin_roster_row's reasoning (20260911130436).
  if not exists (
    select 1 from user_roles
    where user_id = auth.uid() and role = 'system_admin'
  ) then
    raise exception 'Only a system_admin may create a tenant'
      using errcode = '42501';
  end if;

  insert into tenants (name, slug, is_active, tier, feature_flags)
  values (p_name, p_slug, true, 'standard', '{}'::jsonb)
  returning id into v_tenant_id;

  insert into events (tenant_id, name, event_type, status, scheduling_granularity_min)
  values (v_tenant_id, p_name, 'Event', 'draft', 60)
  returning id into v_event_id;

  insert into event_stages (event_id, tenant_id, name, stage_type, race_type, position)
  values
    (v_event_id, v_tenant_id, 'Setup',    'non_race', 'distance', 0),
    (v_event_id, v_tenant_id, 'Race',     'race',     'distance', 1),
    (v_event_id, v_tenant_id, 'Teardown', 'non_race', 'distance', 2);

  -- The first admin, in this same transaction. Without it a failure here
  -- would leave the tenant created and unreachable — the state this whole
  -- change exists to prevent.
  --
  -- grant_tenant_admin re-reads the tier to enforce the cap. A brand-new
  -- tenant is 'standard' (cap 1) with zero admins, so the first one always
  -- fits; the call is made anyway rather than inserting directly, so the cap,
  -- the roster row and the conflict handling stay in exactly one place.
  if p_admin_user_id is not null then
    -- Carry the name through to the roster row. ensure_admin_roster_row reads
    -- auth.users.raw_user_meta_data->>'name' and falls back to the phone
    -- number; the app sets that metadata before calling this, and this
    -- parameter is the explicit path for callers that do not.
    if p_admin_name is not null and trim(p_admin_name) <> '' then
      update auth.users
      set raw_user_meta_data =
            coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('name', trim(p_admin_name))
      where id = p_admin_user_id
        and coalesce(trim(raw_user_meta_data ->> 'name'), '') = '';
    end if;

    v_admin := public.grant_tenant_admin(v_tenant_id, p_admin_user_id);
  end if;

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'event_id',  v_event_id,
    'admin',     v_admin
  );
end;
$$;

comment on function public.create_tenant_with_defaults(text, text, uuid, text) is
  'REL-01 + N20: atomically creates a tenant, its default event, three default '
  'stages (Setup/Race/Teardown) and — when p_admin_user_id is given — its '
  'first tenant_admin with a roster row. SECURITY DEFINER, granted to '
  'service_role only, with an explicit system_admin check in the body '
  '(ADR-0002). A unique-slug violation (23505) propagates unchanged.';

revoke all on function public.create_tenant_with_defaults(text, text, uuid, text) from public;
revoke all on function public.create_tenant_with_defaults(text, text, uuid, text) from anon;
revoke all on function public.create_tenant_with_defaults(text, text, uuid, text) from authenticated;
grant execute on function public.create_tenant_with_defaults(text, text, uuid, text) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select p.proname, p.prosecdef, array_to_string(p.proacl::text[], ' | ')
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('create_tenant_with_defaults', 'grant_tenant_admin',
--                       'revoke_tenant_admin');
--   -- neither anon nor authenticated may appear in any of the ACLs

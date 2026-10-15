-- ============================================================================
-- Migration 20261015130109: fix create_tenant_with_defaults' caller guard
-- ============================================================================
--
-- Fixes a defect introduced by 20261015124237, which made the function
-- unusable by its only permitted caller.
--
-- That migration turned create_tenant_with_defaults into SECURITY DEFINER,
-- granted it to service_role only, and put this guard in the body:
--
--   if not exists (select 1 from user_roles
--                  where user_id = auth.uid() and role = 'system_admin')
--   then raise exception 'Only a system_admin may create a tenant'; end if;
--
-- Under the service_role key there is no GoTrue session, so `auth.uid()` is
-- NULL, the subquery matches nothing, and the guard refuses every call. The
-- function was granted to exactly one role and then written to reject that
-- role: it could not be called at all. Caught by
-- tests/integration/create-tenant-atomicity.test.ts.
--
-- WHY auth.uid() WAS THE WRONG GUARD HERE
-- It was carried over from the SECURITY INVOKER version's reasoning, where the
-- caller really was the signed-in user and RLS evaluated against their JWT.
-- Once the function is service_role-only, the privilege boundary is the GRANT
-- itself, not the session — there is no session. This is exactly how
-- ensure_admin_roster_row (20260911130436) is built: no auth.uid() anywhere,
-- revoked from public/anon/authenticated, granted to service_role, and
-- validating its ARGUMENTS rather than its caller.
--
-- So the guard is replaced rather than repaired: the caller is authorised by
-- the grant, and the app's own assertSystemAdmin() runs before the call
-- (src/app/(system)/admin/actions.ts). What the body validates instead is the
-- argument it is given — that p_admin_user_id, when present, is a real auth
-- user — which is the part a caller could get wrong.
--
-- A belt-and-braces check on auth.uid() is deliberately NOT kept as an
-- "if a session exists, require system_admin" branch. That would re-admit the
-- authenticated role to a code path that writes user_roles the moment someone
-- re-granted execute to it, and the grant is the boundary that should be hard
-- to get wrong. The integration test pins that a signed-in system_admin is
-- refused with 42501.
--
-- Forward-fix: replace (function body only)
--   Rollback: restore the body from 20261015124237. Note that doing so
--             restores the defect — the function becomes uncallable by
--             service_role — so a rollback is only meaningful together with
--             rolling that migration back too.
--   Data:     no data loss. Body-only change; no table or row is touched.
--   Blast:    none in the harmful direction. Before this, every call failed
--             with 42501; after it, the service_role call that the app makes
--             succeeds. No caller gains access it did not already have: the
--             grant list is unchanged (service_role only).
--   Window:   compatible — same signature, same return shape.
-- ============================================================================

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
  -- No auth.uid() check: see the header. The privilege boundary is the grant
  -- (service_role only), and the app verifies system_admin before calling.
  -- What is validated here is the argument, which the caller can get wrong.
  if p_admin_user_id is not null
     and not exists (select 1 from auth.users where id = p_admin_user_id) then
    raise exception 'User % does not exist', p_admin_user_id
      using errcode = '23503';
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
  -- would leave the tenant created and unreachable — the state this change
  -- exists to prevent.
  if p_admin_user_id is not null then
    -- Carry the name through to the roster row. ensure_admin_roster_row reads
    -- auth.users.raw_user_meta_data->>'name' and falls back to the phone
    -- number; the app sets that metadata before calling this, and this
    -- parameter is the explicit path for callers that do not.
    if p_admin_name is not null and trim(p_admin_name) <> '' then
      update auth.users
      set raw_user_meta_data =
            coalesce(raw_user_meta_data, '{}'::jsonb)
            || jsonb_build_object('name', trim(p_admin_name))
      where id = p_admin_user_id
        and coalesce(trim(raw_user_meta_data ->> 'name'), '') = '';
    end if;

    -- grant_tenant_admin re-reads the tier to enforce the cap. A brand-new
    -- tenant is 'standard' (cap 1) with zero admins, so the first one always
    -- fits; the call is made anyway rather than inserting directly, so the
    -- cap, the roster row and the conflict handling stay in exactly one place.
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
  'service_role only (ADR-0002); the caller is authorised by that grant and by '
  'the app''s own assertSystemAdmin(), not by auth.uid(), which is NULL under '
  'the service role. A unique-slug violation (23505) propagates unchanged.';

-- Re-asserted after CREATE OR REPLACE. Replacing a function keeps its ACL, but
-- stating it here keeps the grant visible next to the body it protects, and
-- makes a hand-applied run of this file alone correct.
revoke all on function public.create_tenant_with_defaults(text, text, uuid, text) from public;
revoke all on function public.create_tenant_with_defaults(text, text, uuid, text) from anon;
revoke all on function public.create_tenant_with_defaults(text, text, uuid, text) from authenticated;
grant execute on function public.create_tenant_with_defaults(text, text, uuid, text) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select array_to_string(p.proacl::text[], ' | ')
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'create_tenant_with_defaults';
--   -- postgres and service_role only

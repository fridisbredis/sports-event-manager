-- ============================================================================
-- Migration 20261026134923: grant_system_admin / revoke_system_admin
-- ============================================================================
--
-- N28. Until now a system admin could only be created by hand in SQL or by the
-- dev seed script; the app had no way to do it. This adds the two RPCs a new
-- system admin screen calls, and the audit actions that record them.
--
-- WHY THIS IS MORE SENSITIVE THAN N20/N27
-- system_admin is global and is_system_admin()
-- short-circuits every tenant RLS policy, so one grant opens every tenant.
-- Both RPCs are therefore server-only, and the caller is verified as a
-- system_admin by assertSystemAdmin() before either is called.
--
-- THE LAST-ADMIN GUARD IS ENFORCED HERE, UNDER A LOCK
-- A platform with zero system admins can only be repaired in SQL, so
-- revoke_system_admin refuses to remove the last one (P0001). A count followed
-- by a delete is not enough on its own: two admins removing each other at the
-- same moment would both read "2" and leave none. Both RPCs take the same
-- transaction-scoped advisory lock first, which serialises every change to
-- the system_admin set. There is no single parent row to lock FOR UPDATE the
-- way grant_tenant_admin locks its tenant, which is why this is an advisory
-- lock rather than a row lock.
--
-- Self-removal is refused by the server action, not here: auth.uid() is NULL
-- under service_role (the only role granted these), so the RPC cannot know
-- who is calling. The grant is the privilege boundary.
--
-- ONE PERSON MAY HOLD MORE THAN ONE system_admin ROW
-- 0021's CHECK only requires a tenant_id for the OTHER roles; it does not
-- require null for system_admin, and pre-0021 rows carried a real tenant_id.
-- A user can therefore hold several system_admin rows (the SEC-02 integration
-- test models exactly that). Prod and dev hold only null-tenant rows, one per
-- user, as of 2026-10-26 — but the functions do not rely on it:
--   - grant inserts only when the user has no system_admin row of any kind;
--   - the last-admin guard counts distinct users, not rows;
--   - revoke deletes every system_admin row of the user, since any one left
--     behind would still make is_system_admin() true.
-- A partial unique index on (user_id) was considered and dropped: it would
-- forbid the multi-row state the schema still allows. Duplicates through
-- these RPCs are prevented by the advisory lock instead.
--
-- Revoking deletes only system_admin rows. Any tenant_admin or official rows
-- the same person holds are left untouched.
--
-- AUDIT
-- audit_events.tenant_id is already nullable, and its INSERT policy already
-- admits a system_admin writing a null tenant_id, so a tenant-less event
-- needs only two new action values. target_type stays 'user_role', as for
-- the tenant admin actions (20261015122735).
--
-- Forward-fix: replace (widens audit_events_action_check; both functions are
-- additive)
--   Rollback: drop function if exists public.grant_system_admin(uuid);
--             drop function if exists public.revoke_system_admin(uuid);
--             The CHECK can only be narrowed back while no row uses a new
--             value:
--               select count(*) from audit_events
--               where action in ('system_admin_granted','system_admin_revoked');
--             If zero, re-run the constraint block from 20261015122735. If
--             non-zero, leave the wider constraint in place rather than
--             deleting audit rows to make a rollback possible.
--   Data:     prod snapshot PENDING — taken by hand before the push with
--             scripts/ops/snapshot-prod-db.sh 20261026134923; filename goes
--             here. No data loss expected: on apply, no row is written. At
--             call time grant inserts one user_roles row and revoke deletes
--             a user's system_admin rows, so a bad body could remove a system
--             admin.
--   Blast:    none until the N28 screen calls the RPCs.
--   Window:   compatible. Deployed code never calls the new RPCs nor emits
--             the new audit values; widening a CHECK cannot reject an
--             existing write.
-- ============================================================================

create or replace function public.grant_system_admin(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if p_user_id is null then
    raise exception 'grant_system_admin requires p_user_id'
      using errcode = '22023';
  end if;

  -- Same lock as revoke_system_admin; see the header.
  perform pg_advisory_xact_lock(hashtext('public.system_admin_roles'));

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User % does not exist', p_user_id
      using errcode = '23503';
  end if;

  -- Idempotent: an existing system admin, under any tenant_id, gets no
  -- second row. No unique constraint covers this (see the header); the lock
  -- above is what keeps two concurrent grants from both inserting.
  if exists (
    select 1 from user_roles where user_id = p_user_id and role = 'system_admin'
  ) then
    return jsonb_build_object('granted', false);
  end if;

  insert into user_roles (user_id, tenant_id, role)
  values (p_user_id, null, 'system_admin');

  get diagnostics v_inserted = row_count;

  return jsonb_build_object('granted', v_inserted > 0);
end;
$$;

comment on function public.grant_system_admin is
  'N28: makes a user a global system_admin (user_roles row with tenant_id '
  'null). Idempotent: granting an existing system admin returns granted=false '
  'without inserting. Serialised with revoke_system_admin by an advisory lock.';

create or replace function public.revoke_system_admin(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_user_id is null then
    raise exception 'revoke_system_admin requires p_user_id'
      using errcode = '22023';
  end if;

  -- Same lock as grant_system_admin. Held until commit, so the count below
  -- and the delete after it cannot interleave with another revoke.
  perform pg_advisory_xact_lock(hashtext('public.system_admin_roles'));

  -- Not a system admin: nothing to remove, and no reason to trip the
  -- last-admin guard over a no-op.
  if not exists (
    select 1 from user_roles where user_id = p_user_id and role = 'system_admin'
  ) then
    return jsonb_build_object('revoked', false);
  end if;

  -- Distinct users, not rows: one person holding two system_admin rows is
  -- still one admin.
  if (
    select count(distinct user_id) from user_roles where role = 'system_admin'
  ) <= 1 then
    raise exception 'Cannot remove the last system admin'
      using errcode = 'P0001';
  end if;

  -- Every system_admin row of the user, whatever its tenant_id: a single row
  -- left behind would keep is_system_admin() true.
  delete from user_roles
  where user_id = p_user_id
    and role = 'system_admin';

  get diagnostics v_deleted = row_count;

  return jsonb_build_object('revoked', v_deleted > 0);
end;
$$;

comment on function public.revoke_system_admin is
  'N28: removes a user''s global system_admin role, leaving any tenant roles '
  'they hold. Refuses to remove the last system admin (P0001). Serialised '
  'with grant_system_admin by an advisory lock.';

-- Revoking from public is not enough: Supabase's default ACL on schema public
-- grants EXECUTE to anon and authenticated explicitly, and an explicit grant
-- survives a revoke from PUBLIC. Same four lines as ensure_admin_roster_row.
revoke all on function public.grant_system_admin(uuid) from public;
revoke all on function public.grant_system_admin(uuid) from anon;
revoke all on function public.grant_system_admin(uuid) from authenticated;
grant execute on function public.grant_system_admin(uuid) to service_role;

revoke all on function public.revoke_system_admin(uuid) from public;
revoke all on function public.revoke_system_admin(uuid) from anon;
revoke all on function public.revoke_system_admin(uuid) from authenticated;
grant execute on function public.revoke_system_admin(uuid) to service_role;

alter table public.audit_events
  drop constraint if exists audit_events_action_check;

alter table public.audit_events
  add constraint audit_events_action_check check (
    action = any (array[
      'role_revoked'::text,
      'tenant_created'::text,
      'tenant_activated'::text,
      'tenant_deactivated'::text,
      'tenant_tier_changed'::text,
      'official_invited'::text,
      'announcement_published'::text,
      -- N20
      'tenant_admin_granted'::text,
      'tenant_admin_revoked'::text,
      -- N28
      'system_admin_granted'::text,
      'system_admin_revoked'::text
    ])
  );

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef, proacl from pg_proc
--   where proname in ('grant_system_admin', 'revoke_system_admin');
--   -- proacl must list service_role only: no anon, no authenticated.
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'audit_events_action_check';

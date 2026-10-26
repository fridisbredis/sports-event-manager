-- ============================================================================
-- Migration 20261026123231: revoke_tenant_admin keeps the person an official
-- ============================================================================
--
-- N27 (tenant admins promote and demote officials on OFF-01) makes revoking an
-- admin an everyday action rather than a rare SYS-02 one, which exposed a gap
-- in revoke_tenant_admin (20261015122314).
--
-- THE BUG
-- That migration's header promises that removing the admin role "leaves an
-- ordinary confirmed official". It does not. user_roles is unique on
-- (user_id, tenant_id), so grant_tenant_admin promotes an official by
-- OVERWRITING their 'official' row with 'tenant_admin' — there is only ever
-- one role row per person per tenant. revoke_tenant_admin then DELETED that
-- row, leaving a confirmed officials row with no user_roles row at all. With
-- no role row:
--   - resolvePostLoginRedirect has nothing to route on, so sign-in lands
--     nowhere, and
--   - canViewOfficialSurfaces denies, because it requires an 'official' role
--     row before it looks at the roster.
-- So the person kept their roster row, assignments and consent state, exactly
-- as intended, but could no longer sign in to see any of it.
--
-- THE FIX
-- Demote instead of delete when the person has a confirmed roster row in this
-- tenant: the role row is rewritten to 'official', mirroring how grant wrote
-- it. Every admin granted through grant_tenant_admin has such a row
-- (ensure_admin_roster_row runs in the same transaction), so this is the
-- normal path. An admin with no confirmed roster row — only possible for one
-- added by hand before ensure_admin_roster_row existed — has no official
-- identity to fall back to, and their row is still deleted as before.
--
-- ALSO: THE LAST-ADMIN GUARD NOW LOCKS
-- The old body counted admins and then deleted without a lock, so two
-- concurrent revokes of the last two admins could both see a count of 2 and
-- both proceed, leaving the tenant with none. N27 makes that reachable — two
-- admins demoting each other from OFF-01 at the same moment. The tenant row
-- is now locked FOR UPDATE first, the same lock grant_tenant_admin takes, so
-- grants and revokes for one tenant are serialised against each other.
--
-- RETURN SHAPE
-- Keeps 'revoked' (read by revokeTenantAdmin in (system)/admin/actions.ts and
-- now by the shared helper in lib/auth/tenant-admins.ts). Adds 'demoted':
-- true when the person kept an 'official' role, false when the row was
-- deleted or nothing was revoked. Asserted by
-- tests/integration/revoke-tenant-admin.test.ts against real Postgres.
--
-- Forward-fix: replace
--   Rollback: Restore the definition from migration
--             20261015122314_grant_revoke_tenant_admin_rpcs.sql (same
--             signature, create or replace). Rows this version demoted stay
--             'official'; that is the state the old header already claimed.
--   Data:     prod snapshot 20261026123231_pre-migration_2026-10-26T13-21-08Z.tar.gz
--             (Azure Blob sportsevtmgrprodsnaps, container db-snapshots),
--             taken by hand before the push; restore with
--             scripts/ops/restore-prod-db.sh <that filename>. Not required
--             for a replace, taken anyway as a record of user_roles as they
--             stood. No data loss expected: changes no existing row on
--             apply; at call time it updates or deletes exactly one
--             user_roles row, as before.
--   Blast:    a bad body breaks removing a tenant admin in SYS-02 and OFF-01.
--             Granting, sign-in and every other path are untouched.
--   Window:   compatible. Same signature and grants, and the old caller only
--             reads 'revoked', which is still returned.
-- ============================================================================

create or replace function public.revoke_tenant_admin(
  p_tenant_id uuid,
  p_user_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin    boolean;
  v_has_roster  boolean;
  v_changed     integer;
begin
  if p_tenant_id is null or p_user_id is null then
    raise exception 'revoke_tenant_admin requires both p_tenant_id and p_user_id'
      using errcode = '22023';
  end if;

  -- Serialise against grant_tenant_admin and other revokes for this tenant,
  -- so the count below cannot be raced. See the header.
  perform 1 from tenants where id = p_tenant_id for update;

  if not found then
    raise exception 'Tenant % does not exist', p_tenant_id
      using errcode = '23503';
  end if;

  select exists (
    select 1 from user_roles
    where tenant_id = p_tenant_id and user_id = p_user_id and role = 'tenant_admin'
  ) into v_is_admin;

  -- Not an admin: nothing to revoke. Checked before the last-admin guard so
  -- that a stale click on someone already demoted is a quiet no-op rather
  -- than a misleading "cannot remove the last admin".
  if not v_is_admin then
    return jsonb_build_object('revoked', false, 'demoted', false);
  end if;

  -- Refuse to remove the last admin. A tenant with no admins cannot be
  -- entered by anyone but a system admin.
  if (
    select count(*) from user_roles
    where tenant_id = p_tenant_id and role = 'tenant_admin'
  ) <= 1 then
    raise exception 'Cannot remove the last admin of tenant %', p_tenant_id
      using errcode = 'P0001';
  end if;

  select exists (
    select 1 from officials
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and invite_status = 'confirmed'
  ) into v_has_roster;

  if v_has_roster then
    -- created_at is deliberately left alone, as grant leaves it alone on a
    -- promotion: if this person is promoted again, their original join time
    -- keeps ordering them in the tier cap.
    update user_roles
    set role = 'official'
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and role = 'tenant_admin';
  else
    delete from user_roles
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and role = 'tenant_admin';
  end if;

  get diagnostics v_changed = row_count;

  return jsonb_build_object(
    'revoked', v_changed > 0,
    'demoted', v_changed > 0 and v_has_roster
  );
end;
$$;

comment on function public.revoke_tenant_admin is
  'N20/N27: removes a user''s tenant_admin role. When they have a confirmed '
  'roster row the role is rewritten to ''official'' so they can still sign in '
  'as an official; otherwise the role row is deleted. Refuses to remove the '
  'last admin of a tenant (P0001). Locks the tenant row, like '
  'grant_tenant_admin, so concurrent revokes cannot pass the last-admin guard.';

-- create or replace keeps existing grants, but they are restated so this file
-- alone shows the function is server-only.
revoke all on function public.revoke_tenant_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_tenant_admin(uuid, uuid) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select pg_get_functiondef('public.revoke_tenant_admin(uuid, uuid)'::regprocedure)
--     ilike '%set role = ''official''%';

-- ============================================================================
-- Migration 20261015122314: grant_tenant_admin / revoke_tenant_admin
-- ============================================================================
--
-- N20. System admins manage a tenant's admins from SYS-02: see them, add one,
-- remove one. Adding one is also how a brand-new tenant gets its FIRST admin —
-- which today has no code path at all. create_tenant_with_defaults creates the
-- tenant, its event and three stages, but no role row, and every RPC that
-- inserts into user_roles hardcodes 'official'. Verified against prod
-- 2026-10-15: "Micke testar" and "Eddo testar" have zero tenant_admin rows and
-- are therefore unreachable by anyone but a global system_admin. Viadal's
-- three admins were inserted by hand.
--
-- WHY AN RPC RATHER THAN TWO .insert() CALLS
-- REL-01 / docs/patterns/atomic-multi-table-writes.md: granting an admin is
-- two writes — the user_roles row, then the officials roster row that makes
-- them visible and schedulable (F-MNT-20). A failure between them leaves a
-- tenant_admin with no roster row, which is the shape that already caused the
-- MYSCH-01 bug. One transaction instead.
--
-- THE CAP IS ENFORCED HERE, NOT ONLY IN THE APP
-- The app checks it too (lib/auth/tenant-admins.ts) for a good error message,
-- but the app's check is a read followed by a write and two concurrent grants
-- could both pass it. The count below runs inside the same transaction as the
-- insert, so the cap holds under concurrency. The tier→cap numbers are
-- duplicated from src/lib/tiers/features.ts; that duplication is deliberate
-- and commented there, because a cap that only exists in TypeScript is not a
-- cap on a database anyone can reach through PostgREST.
--
-- SECURITY DEFINER, granted to service_role only
-- Follows ensure_admin_roster_row (20260911130436) and ADR-0002: these write
-- user_roles, which no RLS policy lets the authenticated role touch, and they
-- read auth.users for the phone. The caller is already verified as
-- system_admin by assertSystemAdmin() before either is called. Revoked from
-- public/anon/authenticated so they are server-only.
--
-- WHY revoke_tenant_admin DELETES THE ROLE BUT KEEPS THE ROSTER ROW
-- The officials row is the person's identity in the tenant — their name,
-- phone, avatar, SMS opt-out, and any assignments pointing at them. Deleting
-- it would orphan assignments and silently drop GDPR-relevant consent state.
-- Removing the admin role leaves an ordinary confirmed official, which is what
-- "remove an admin" should mean. Removing the person entirely is what
-- remove_official (0025) already does, and SYS-02 does not need a second way
-- to do it.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.grant_tenant_admin(uuid, uuid);
--             drop function if exists public.revoke_tenant_admin(uuid, uuid);
--             Role rows either function wrote are ordinary user_roles rows;
--             remove one with
--               delete from user_roles where tenant_id = $1 and user_id = $2
--                 and role = 'tenant_admin';
--             Check first whether that admin pre-dated this feature — the
--             three Viadal rows did.
--   Data:     no data loss. grant inserts; revoke deletes exactly one
--             user_roles row and never touches officials.
--   Blast:    none until SYS-02 calls them. No existing read or write path
--             changes.
--   Window:   compatible — additive, nothing deployed depends on these.
-- ============================================================================

create or replace function public.grant_tenant_admin(
  p_tenant_id uuid,
  p_user_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier         text;
  v_cap          integer;
  v_current      integer;
  v_already      boolean;
  v_roster       jsonb;
begin
  if p_tenant_id is null or p_user_id is null then
    raise exception 'grant_tenant_admin requires both p_tenant_id and p_user_id'
      using errcode = '22023';
  end if;

  -- Lock the tenant row for the rest of the transaction. Two concurrent
  -- grants would otherwise both read the same count below and both insert,
  -- putting the tenant one over its cap. Locking the tenant (rather than the
  -- role rows, which do not all exist yet) serialises grants per tenant while
  -- leaving other tenants unaffected.
  select tier into v_tier
  from tenants
  where id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant % does not exist', p_tenant_id
      using errcode = '23503';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User % does not exist', p_user_id
      using errcode = '23503';
  end if;

  -- Mirrors MAX_TENANT_ADMINS in src/lib/tiers/features.ts. An unrecognised
  -- tier falls to the lowest cap, matching maxTenantAdmins()'s fail-closed
  -- behaviour, rather than defaulting to unlimited.
  v_cap := case v_tier
             when 'professional' then 10
             when 'premium'      then 3
             else 1
           end;

  -- Already an admin: succeed without inserting a duplicate. The unique
  -- constraint on (user_id, tenant_id) would reject it anyway, but a system
  -- admin clicking twice should not see an error, and this also keeps the
  -- count below from being spent on a row that already exists.
  select exists (
    select 1 from user_roles
    where user_id = p_user_id and tenant_id = p_tenant_id and role = 'tenant_admin'
  ) into v_already;

  if not v_already then
    select count(*) into v_current
    from user_roles
    where tenant_id = p_tenant_id and role = 'tenant_admin';

    if v_current >= v_cap then
      raise exception 'Tenant % is at its admin cap (% of %)', p_tenant_id, v_current, v_cap
        using errcode = 'P0001';
    end if;

    -- A user holding a different role in this tenant (an 'official' being
    -- promoted) has a row already, and (user_id, tenant_id) is unique — so
    -- this is an upsert on that key, not a plain insert. created_at is left
    -- to its default for a new row; for a promoted official it is deliberately
    -- NOT reset, so their original join time keeps ordering them in the cap.
    insert into user_roles (user_id, tenant_id, role)
    values (p_user_id, p_tenant_id, 'tenant_admin')
    on conflict (user_id, tenant_id) do update set role = 'tenant_admin';
  end if;

  -- Second write, same transaction: the roster row that makes this admin
  -- visible on OFF-01 and schedulable on SCHED-01 (F-MNT-20). Reuses the
  -- existing RPC rather than duplicating its auth.users lookup and its
  -- '+'-stripping phone normalisation.
  v_roster := public.ensure_admin_roster_row(p_tenant_id, p_user_id);

  return jsonb_build_object(
    'granted',     not v_already,
    'official_id', v_roster ->> 'official_id',
    'cap',         v_cap
  );
end;
$$;

comment on function public.grant_tenant_admin is
  'N20: makes a user a tenant_admin of a tenant and ensures their roster row, '
  'in one transaction. Enforces the per-tier admin cap inside the transaction '
  '(tenant row locked FOR UPDATE), so concurrent grants cannot exceed it. '
  'Raises P0001 when the tenant is at its cap. Idempotent: granting an '
  'existing admin again succeeds without inserting.';

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
  v_deleted integer;
begin
  if p_tenant_id is null or p_user_id is null then
    raise exception 'revoke_tenant_admin requires both p_tenant_id and p_user_id'
      using errcode = '22023';
  end if;

  -- Refuse to remove the last admin. A tenant with no admins is exactly the
  -- unusable state this card exists to fix, and SYS-02 should not be able to
  -- create it by accident. A system admin who genuinely wants to empty a
  -- tenant can deactivate it instead.
  if (
    select count(*) from user_roles
    where tenant_id = p_tenant_id and role = 'tenant_admin'
  ) <= 1 then
    raise exception 'Cannot remove the last admin of tenant %', p_tenant_id
      using errcode = 'P0001';
  end if;

  delete from user_roles
  where tenant_id = p_tenant_id
    and user_id = p_user_id
    and role = 'tenant_admin';

  get diagnostics v_deleted = row_count;

  -- The officials row is deliberately left in place — see the header. The
  -- person stays an ordinary official of this tenant.
  return jsonb_build_object('revoked', v_deleted > 0);
end;
$$;

comment on function public.revoke_tenant_admin is
  'N20: removes a user''s tenant_admin role. Leaves their officials roster row '
  'intact, so they remain an ordinary official rather than losing their '
  'identity, assignments and consent state. Refuses to remove the last admin '
  'of a tenant (P0001).';

revoke all on function public.grant_tenant_admin(uuid, uuid) from public;
revoke all on function public.revoke_tenant_admin(uuid, uuid) from public;
grant execute on function public.grant_tenant_admin(uuid, uuid) to service_role;
grant execute on function public.revoke_tenant_admin(uuid, uuid) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc
--   where proname in ('grant_tenant_admin', 'revoke_tenant_admin');

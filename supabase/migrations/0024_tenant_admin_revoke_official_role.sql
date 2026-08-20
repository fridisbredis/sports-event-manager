-- ============================================================================
-- Migration 0024: tenant_admin SELECT + DELETE on user_roles, scoped to
-- role = 'official' only
-- ============================================================================
--
-- F-SEC-03 (see docs/security/service-role-audit.md, "Blocked: row #17"):
-- DELETE /api/officials/[id] revokes the removed official's user_roles row
-- as its third step, after the officials soft-delete. user_roles had exactly
-- two policies before this migration:
--   - system_admin_manage_roles (FOR ALL, is_system_admin())
--   - user_read_own_role        (SELECT, self only)
-- No tenant_admin policy existed at all, so a tenant_admin's DELETE against
-- this table silently matched zero rows under RLS — the officials row shows
-- 'removed' but the role survives, and role revocation quietly stops working
-- the moment that write moves off the service-role client.
--
-- A DELETE-only policy is not sufficient on its own: Postgres RLS requires a
-- row to be visible via some SELECT-permitting policy before a DELETE's
-- USING clause is even evaluated against it. Verified directly against the
-- local Postgres instance during this migration's development — with only
-- the DELETE policy in place, a tenant_admin's own SELECT of another user's
-- row already returned zero rows (blocked by user_read_own_role, which is
-- self-only), so the DELETE matched nothing even though its USING clause
-- was true in isolation. Both a SELECT and a DELETE policy are required,
-- both scoped identically.
--
-- Both policies are intentionally narrow: they only ever apply to rows with
-- role = 'official'. A tenant_admin can see and revoke an official's access,
-- but can never see or delete a tenant_admin or system_admin row through
-- these policies, in their own tenant or any other — that would be a
-- privilege-escalation path (e.g. a tenant_admin reading or removing a
-- co-admin, or reaching for a system_admin row). Only
-- system_admin_manage_roles can touch those.
--
-- Follows the migration-0004 naming and shape convention
-- (tenant_admin_manage_<table>, is_system_admin() OR clause) but named
-- for the narrower action each policy actually grants, not "manage".
-- ============================================================================

drop policy if exists "tenant_admin_read_official_role" on public.user_roles;
create policy "tenant_admin_read_official_role"
  on public.user_roles for select
  using (
    role = 'official'
    and (
      public.get_user_role(tenant_id) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

comment on policy "tenant_admin_read_official_role" on public.user_roles is
  'F-SEC-03: lets a tenant_admin (or system_admin) see an official''s own '
  'user_roles row in their tenant. Required for '
  'tenant_admin_revoke_official_role''s DELETE to be able to match the row '
  'at all — RLS requires SELECT visibility before a DELETE USING clause is '
  'evaluated. Scoped to role = ''official'' only, same reasoning as that '
  'policy.';

drop policy if exists "tenant_admin_revoke_official_role" on public.user_roles;
create policy "tenant_admin_revoke_official_role"
  on public.user_roles for delete
  using (
    role = 'official'
    and (
      public.get_user_role(tenant_id) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

comment on policy "tenant_admin_revoke_official_role" on public.user_roles is
  'F-SEC-03: lets a tenant_admin (or system_admin) delete an official''s '
  'own user_roles row in their tenant, e.g. on official removal. Scoped to '
  'role = ''official'' only — never lets a tenant_admin delete a '
  'tenant_admin/system_admin row, which would be privilege escalation.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select polname, polcmd, pg_get_expr(polqual, polrelid)
--   from pg_policy where polrelid = 'public.user_roles'::regclass;

-- ============================================================================
-- Migration: let a tenant admin update their own tenant row
-- ============================================================================
--
-- EVT-01's colour theme picker writes tenants.color_palette as the signed-in
-- tenant admin. `tenants` had no UPDATE policy for that role — only
-- system_admin_all_tenants (ALL, gated on is_system_admin()) and
-- tenant_member_read (SELECT) — so the write matched no policy.
--
-- Postgres does not raise on that. An UPDATE whose rows are all filtered out
-- by RLS reports success with a zero row count, so PostgREST returned 200, the
-- server action saw no error, and the picker reported a save that never
-- happened. The theme then stayed on whatever was stored, which is what the
-- bug looked like from the UI: "it won't change off this colour".
--
-- Scope is deliberately narrow — UPDATE only:
--   * No INSERT: tenants are provisioned by a system admin, not self-served.
--   * No DELETE: removing a tenant stays a system-admin action.
-- Both remain available to system_admin through the existing ALL policy.
--
-- USING and WITH CHECK both apply: USING decides which existing rows are
-- visible to the UPDATE, WITH CHECK decides what the row may become. Without
-- WITH CHECK a tenant admin could rewrite their row's `id` and take over
-- another tenant; with it, the row must still belong to a tenant they
-- administer after the update.
--
-- Note this grants write access to every column of the row, including `tier`
-- and `is_active` — RLS is row-level, not column-level. The application only
-- ever writes color_palette here, and the system-admin surfaces own the other
-- fields, but a future column on this table is covered by this policy by
-- default. If a column must stay system-admin-only, it needs a column
-- privilege or a trigger; a row policy cannot express it.
--
-- Forward-fix: additive
--   Rollback: `DROP POLICY IF EXISTS tenant_admin_update_own_tenant
--              ON public.tenants;`
--             Reverting re-breaks the theme picker but loses no data.
--   Data:     none touched. Policy only.
--   Blast:    widens what a tenant_admin may write on exactly one table, to
--             rows they already administer. No existing policy is modified,
--             so system_admin and read paths are unchanged.
--   Window:   compatible in both directions. Old builds simply never exercise
--             the new policy.
-- ============================================================================

DROP POLICY IF EXISTS tenant_admin_update_own_tenant ON public.tenants;

CREATE POLICY tenant_admin_update_own_tenant
  ON public.tenants
  FOR UPDATE
  USING (
    public.get_user_role(id) = 'tenant_admin'
    or public.is_system_admin()
  )
  WITH CHECK (
    public.get_user_role(id) = 'tenant_admin'
    or public.is_system_admin()
  );

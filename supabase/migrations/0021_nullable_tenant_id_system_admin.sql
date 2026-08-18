-- ---------------------------------------------------------------------------
-- Migration 0021: nullable tenant_id for the global system_admin role
-- ---------------------------------------------------------------------------
--
-- system_admin is a global role: is_system_admin() (0002) checks only
-- role = 'system_admin' and never reads tenant_id, and app code
-- (src/lib/auth/tenant.ts) already treats system_admin as tenant-agnostic.
-- Making tenant_id nullable removes the need to attach a system_admin's
-- user_roles row to an arbitrary real tenant just to satisfy NOT NULL.
--
-- No RLS or app-code behavior changes: is_system_admin() and the app-level
-- auth helpers already ignored tenant_id for this role before this
-- migration, so existing system_admin rows (with a real tenant_id) and new
-- ones (with a null tenant_id) are both handled identically.
--
-- Run on BOTH dev and prod Supabase projects.
--
-- Verify after running:
--
--   select column_name, is_nullable
--   from information_schema.columns
--   where table_name = 'user_roles' and column_name = 'tenant_id';
--
--   Expect is_nullable = 'YES'. Also confirm the constraint exists:
--
--   select conname from pg_constraint
--   where conname = 'user_roles_tenant_id_required_unless_system_admin';
--
-- Applied:
--   dev  (lhflutwvwvzawzbcuwup) — 2026-08-13, verified
--   prod — NOT YET APPLIED
-- ---------------------------------------------------------------------------

alter table public.user_roles
  alter column tenant_id drop not null;

alter table public.user_roles
  add constraint user_roles_tenant_id_required_unless_system_admin
  check (tenant_id is not null or role = 'system_admin');

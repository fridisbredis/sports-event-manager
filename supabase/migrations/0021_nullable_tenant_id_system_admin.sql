-- system_admin is a global role: is_system_admin() (0002) checks only
-- role = 'system_admin' and never reads tenant_id, and app code
-- (src/lib/auth/tenant.ts) already treats system_admin as tenant-agnostic.
-- Making tenant_id nullable removes the need to attach a system_admin's
-- user_roles row to an arbitrary real tenant just to satisfy NOT NULL.

alter table public.user_roles
  alter column tenant_id drop not null;

alter table public.user_roles
  add constraint user_roles_tenant_id_required_unless_system_admin
  check (tenant_id is not null or role = 'system_admin');

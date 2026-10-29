-- ============================================================================
-- Migration 20261028095200: tenant admins may change only color_palette (B13)
-- ============================================================================
--
-- tenant_admin_update_own_tenant (20260928165612) gives a tenant admin UPDATE
-- on their own tenants row so EVT-01's colour picker can save color_palette.
-- RLS is row-level, so that policy grants every column of the row: a tenant
-- admin could set their own tier to professional (unlocking every tier gate,
-- the N20 admin cap and the N24 SMS cap), reactivate a deactivated tenant, or
-- change the slug, straight through PostgREST. Verified locally 2026-10-27.
--
-- N13 closed the same hole for one column (guard_tenant_sms_sender_id). This
-- replaces that guard with an allowlist instead of adding more columns to a
-- denylist: from a user session, only a system admin may change anything but
-- color_palette. A column added to tenants later is protected without anyone
-- having to remember this trigger. N23 depends on it, since the per-tier
-- event cap is meaningless if a tenant can raise its own tier.
--
-- name is covered too: no tenant-admin UI writes it, and under N23 the tenant
-- name is the organizer's name, which a system admin sets.
--
-- The comparison is by value, so an UPDATE that rewrites other columns with
-- their current values still passes. Roles other than anon and authenticated
-- pass (service_role, SECURITY DEFINER RPCs running as their owner, the
-- migration role): auth.uid() is NULL under service_role, so
-- is_system_admin() alone would wrongly block them.
--
-- Forward-fix: replace (trigger and function replaced; no schema or data change)
--   Rollback: drop trigger if exists tenants_guard_system_admin_columns on public.tenants;
--             drop function if exists public.guard_tenant_system_admin_columns();
--             then restore guard_tenant_sms_sender_id and its trigger from
--             migration 20261027143113_tenant_sms_sender_id.sql.
--   Data:     prod snapshot 20261028095200_pre-migration_2026-10-29T12-48-16Z.tar.gz (N23 release).
--             no data loss. Writes no rows.
--   Blast:    if the allowlist were wrong, a tenant admin saving the colour
--             theme gets a permission error (the theme stays as it was), or a
--             system admin cannot change tier/active/sender. Both are visible
--             at once in EVT-01 and SYS-02.
--   Window:   compatible. Deployed code writes only color_palette as a tenant
--             admin, and tier, is_active and sms_sender_id as a system admin.
-- ============================================================================

create or replace function public.guard_tenant_system_admin_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'color_palette') is distinct from (to_jsonb(old) - 'color_palette')
     and current_user in ('anon', 'authenticated')
     and not public.is_system_admin() then
    raise exception 'only a system admin can change this tenant setting'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_tenant_system_admin_columns() is
  'B13: from a user session, only a system admin may change tenants columns '
  'other than color_palette. Replaces guard_tenant_sms_sender_id (N13).';

drop trigger if exists tenants_guard_system_admin_columns on public.tenants;

create trigger tenants_guard_system_admin_columns
  before update on public.tenants
  for each row
  execute function public.guard_tenant_system_admin_columns();

drop trigger if exists tenants_guard_sms_sender_id on public.tenants;
drop function if exists public.guard_tenant_sms_sender_id();

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select tgname from pg_trigger
--   where tgrelid = 'public.tenants'::regclass and not tgisinternal;
--   -- expect tenants_guard_system_admin_columns only

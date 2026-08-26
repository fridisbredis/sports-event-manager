-- ============================================================================
-- Migration 0032 (prod variant): fix sms_queue insert permission
-- ============================================================================
--
-- Identical to 0032_fix_sms_queue_insert_permission.sql (dev). Prod already
-- has 0030_sms_queue_prod.sql applied (including the same bug: sms_queue
-- revoked from `authenticated` entirely), so POST /api/announcements will
-- fail the same way in prod once the PERF-04 code is deployed there, unless
-- this fix is applied first.
-- ============================================================================

grant insert on public.sms_queue to authenticated;

drop policy if exists tenant_admin_insert_sms_queue on public.sms_queue;
create policy tenant_admin_insert_sms_queue
  on public.sms_queue
  for insert
  to authenticated
  with check (
    public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin()
  );

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select polname, polcmd, polroles::regrole[] from pg_policy
--   where polrelid = 'public.sms_queue'::regclass;

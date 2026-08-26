-- ============================================================================
-- Migration 0032: fix sms_queue insert permission for tenant admins
-- ============================================================================
--
-- Bug in 0030: sms_queue was revoked from `authenticated` entirely, on the
-- assumption only the service-role worker route would ever touch it. But
-- POST /api/announcements enqueues rows using createSupabaseServerClient()
-- (the RLS-scoped client, running as the logged-in tenant_admin) — the same
-- defense-in-depth pattern documented in CLAUDE.md, where route handlers use
-- the requesting user's own session rather than the service role wherever
-- possible. That insert was failing in dev with 42501 permission denied for
-- table sms_queue.
--
-- Fix: grant INSERT to authenticated, gated by the standard tenant_admin RLS
-- policy convention from migration 0004 (is_system_admin() OR clause
-- mandatory — see CLAUDE.md). SELECT/UPDATE/DELETE stay service-role-only;
-- the worker route (claim_sms_queue_batch + direct table access) is the only
-- other writer and it already runs as service_role, which bypasses RLS.
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

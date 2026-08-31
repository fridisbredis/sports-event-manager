-- ============================================================================
-- Migration 0035: revoke anon's default DML grants on all public tables
-- ============================================================================
--
-- Supabase's hosted platform grants select/insert/update/delete on every
-- table in `public` to anon/authenticated/service_role by default, and no
-- migration has ever declared or reviewed that for anon specifically. This
-- was surfaced as a side finding in F-REL-09 (docs/quality-requirements.md,
-- rollback rehearsal 2026-08-26) and filed as "expected noise, not drift" —
-- true, but that is not the same as "reviewed and intentional". See
-- docs/adr/0002-anon-role-default-dml-grants.md for the full writeup this
-- migration resolves.
--
-- Zero RLS policies in this schema target anon (every policy checks
-- get_user_role(tenant_id) or is_system_admin(), both of which require an
-- authenticated user_roles row). So today anon's insert/update/delete
-- attempts already fail every row-security check and silently affect zero
-- rows. The grant was never the thing stopping anon from writing — RLS was.
-- This migration removes the redundant grant so the app's actual writable
-- surface is min(grant, policy) instead of just policy, matching the
-- treatment rate_limit_hits (0026) and sms_queue (0030/0032) already got.
--
-- Confirmed safe (2026-08-28, before writing this migration): no code path
-- performs a table write via the anon-keyed browser client
-- (createSupabaseBrowserClient in src/lib/supabase/client.ts). Its only two
-- call sites — the login page and the invite-accept form — call only
-- supabase.auth.signInWithOtp/verifyOtp (Auth API, not affected by table
-- grants). Every Server Action and API route that writes uses the
-- session-cookie client or the service-role client, never the anon key
-- directly.
--
-- select is intentionally left untouched here: every table already has RLS
-- policies gating reads for the roles that need them, and no policy targets
-- anon for select either, so anon already reads zero rows everywhere. This
-- migration is scoped to insert/update/delete to keep the change narrow and
-- match exactly the ADR-0002 question that was asked. authenticated and
-- service_role are untouched — this is anon-only.
--
-- rate_limit_hits and sms_queue are excluded below: 0026 and 0030/0032
-- already revoked anon there with dedicated deny-all policies and tests
-- (tests/integration/rate-limit.test.ts) asserting the 42501. Re-running the
-- same revoke here is harmless (revoke is idempotent) but they're left out
-- to keep this migration's diff scoped to the tables F-REL-09 actually
-- flagged as unreviewed.
--
-- supabase/seed.sql's local grants must be updated in the same PR as this
-- migration, or a clean `supabase db reset` will silently re-grant anon
-- everything this migration just revoked and local dev will no longer match
-- dev/prod.
--
-- Forward-fix: destructive
--   Rollback: grant insert, update, delete on table
--               public.tenants, public.user_roles, public.events,
--               public.event_stages, public.event_distances,
--               public.event_facilities, public.officials,
--               public.participants, public.assignments,
--               public.announcements, public.workstations,
--               public.workstation_operating_windows,
--               public.workstation_todos
--             to anon;
--             Restores the platform-default grant this migration removes.
--   Data:     No data loss — this changes privileges, not rows. Nothing is
--             deleted, updated, or read by this migration itself.
--   Blast:    None expected. Verified 2026-08-28: no application code path
--             writes to Postgres as anon (see confirmation above). If some
--             untraced path did rely on it, the failure mode is a loud
--             42501 permission-denied on that specific write — not silent
--             data loss — which is the same fail-closed behavior
--             rate_limit_hits and sms_queue already rely on.
--   Window:   Compatible. The currently-deployed code never writes as anon
--             (confirmed above), so removing a grant nothing legitimate used
--             cannot break it during the deploy window.
-- ============================================================================

revoke insert, update, delete on table
  public.tenants,
  public.user_roles,
  public.events,
  public.event_stages,
  public.event_distances,
  public.event_facilities,
  public.officials,
  public.participants,
  public.assignments,
  public.announcements,
  public.workstations,
  public.workstation_operating_windows,
  public.workstation_todos
from anon;

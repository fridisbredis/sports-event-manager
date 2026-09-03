-- ============================================================================
-- Migration 0042: role_granted_via_invite_confirmation on auth_events (SEC-07)
-- ============================================================================
--
-- SEC-07 gap: role grants that happen when an invited official confirms
-- their invite via OTP (confirm_official_invite / confirm_official_invite_by_
-- phone, migrations 0017/0018) were never audited. audit_events (0037)
-- explicitly excludes this case in its header — its actor_role check only
-- allows ('system_admin', 'tenant_admin'), and the actor here is the
-- invited official authenticating via OTP, not an admin.
--
-- This reuses auth_events (0038) rather than adding a third table: both
-- confirm call sites (src/app/api/officials/confirm/route.ts and
-- src/lib/auth/tenant.ts's confirmOfficialInvite) already write via the
-- service-role client for the same reason auth_events exists — there is no
-- admin session, often barely any session at all, to derive an RLS INSERT
-- policy from. Unlike OTP send/verify, this flow DOES know tenant_id at
-- write time, so this event populates that existing nullable column instead
-- of leaving it null.
--
-- Forward-fix: additive
--   Rollback: alter table public.auth_events
--               drop constraint auth_events_event_check,
--               add constraint auth_events_event_check check (event in (
--                 'otp_send_succeeded', 'otp_send_failed',
--                 'otp_send_rate_limited', 'otp_send_rate_limit_error',
--                 'otp_verify_succeeded', 'otp_verify_failed',
--                 'otp_verify_rate_limited', 'otp_verify_rate_limit_error'
--               ));
--             Safe at any time — restores 0038's original constraint exactly.
--   Data:     No data loss. Rows already written with the new event value
--             are untouched by a constraint change; only future inserts of
--             that value would be rejected after a rollback.
--   Blast:    Fully additive. The write helper (log-auth-event.ts) is
--             fail-safe like every other call site — a rejected event value
--             just logs via logger.error and never changes the confirm/login
--             response.
--   Window:   Compatible. Old code never passes the new event value, so it
--             cannot violate either the old or new constraint. New code
--             passing the new value needs this migration applied first —
--             already guaranteed by the schema-first deploy order.
-- ============================================================================

alter table public.auth_events
  drop constraint auth_events_event_check,
  add constraint auth_events_event_check check (event in (
    'otp_send_succeeded',
    'otp_send_failed',
    'otp_send_rate_limited',
    'otp_send_rate_limit_error',
    'otp_verify_succeeded',
    'otp_verify_failed',
    'otp_verify_rate_limited',
    'otp_verify_rate_limit_error',
    'role_granted_via_invite_confirmation'
  ));

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.auth_events'::regclass
--     and conname = 'auth_events_event_check';

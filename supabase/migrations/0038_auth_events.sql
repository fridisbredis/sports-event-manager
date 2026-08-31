-- ============================================================================
-- Migration 0038: auth_events table (SEC-07-rest)
-- ============================================================================
--
-- SEC-07 (migration 0037) deliberately excluded OTP/login audit events: its
-- audit_events table assumes an already-authenticated admin actor
-- (actor_role check in ('system_admin', 'tenant_admin'), and an INSERT
-- policy requiring actor_user_id = auth.uid()). Login is the one flow where
-- that assumption cannot hold — a failed OTP verify has no auth.uid() at
-- all, and a successful one authenticates as whatever role the phone number
-- maps to (official, participant, or nothing yet), not an admin. Rather than
-- weaken audit_events' write-once-admin model to fit a fundamentally
-- different case, this is a separate table with its own actor model.
--
-- Scope for this migration:
--   - otp_send_succeeded / otp_send_failed   (POST /api/auth/send-otp)
--   - otp_verify_succeeded / otp_verify_failed (POST /api/auth/verify-otp)
--   - otp_send_rate_limited / otp_verify_rate_limited — the request never
--     reached Supabase Auth at all because checkLoginSendRateLimit/
--     checkLoginVerifyRateLimit (src/lib/rate-limit.ts) rejected it first.
--     Distinct from *_failed (which means Supabase Auth itself rejected the
--     request): a rate-limited burst is the clearest brute-force signal this
--     table can capture, and folding it into *_failed would hide exactly the
--     traffic pattern (sustained guessing) an auditor most needs to see.
--   - otp_send_rate_limit_error / otp_verify_rate_limit_error — the rate
--     limit check itself threw (e.g. the check_rate_limit RPC errored), so
--     the route fails closed with a 503 before reaching Supabase Auth.
--     Recorded separately from *_rate_limited so a review can tell "the
--     limiter blocked a real abuse attempt" apart from "the limiter's own
--     infrastructure broke" — the same distinction the route already makes
--     via two different HTTP status codes (429 vs 503).
--
-- actor_user_id is nullable and unconstrained by any check on the caller's
-- own session, because there frequently is no session: a failed verify has
-- no authenticated caller, and even a successful send/verify is written
-- before or without the request having proven anything about who is
-- allowed to write this row. That is why this table is written exclusively
-- via the service-role client (ADR-0001 category 5 below), never the
-- session client — there is no session to derive an INSERT policy from.
--
-- phone_hash (not phone) mirrors rate-limit.ts's loginPhoneRateLimitKey:
-- sha256 of the digits-only phone number. Never store a raw phone number
-- here — same GDPR-retention reasoning as the rate-limit keys, and this
-- table has no retention/anonymization job like officials/participants do
-- (SEC-09), so a raw phone would persist indefinitely with no cleanup path.
--
-- tenant_id is nullable and almost always null at write time: neither route
-- resolves a tenant today (see verify-otp/route.ts, which returns {ok:true}
-- without reading back the user's role/tenant). Left as a future
-- enrichment column rather than populated now — do not add a lookup just to
-- fill it; that is separate scope.
--
-- Forward-fix: additive
--   Rollback: drop table if exists public.auth_events;
--             Safe at any time — no other table FKs to auth_events, no RPC
--             or view depends on it. The write helper (planned:
--             src/lib/audit/log-auth-event.ts) is fail-safe like
--             logAuditEvent(): a missing table just makes every insert fail
--             and get logged via logger.error, never changing the login
--             response.
--   Data:     No data loss beyond the audit rows themselves, which is the
--             intended effect of a rollback. No existing table, column,
--             constraint, or policy is touched.
--   Blast:    Fully additive and isolated. Deploy order in either direction
--             is safe: schema-before-code leaves the table empty and
--             unused; code-before-schema fails closed the same way
--             logAuditEvent() does.
--   Window:   Compatible. No lock concerns — new table, no backfill.
-- ============================================================================

create table public.auth_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenants(id) on delete set null,
  actor_user_id    uuid references auth.users(id) on delete set null,
  phone_hash       text not null,
  event            text not null check (event in (
                     'otp_send_succeeded',
                     'otp_send_failed',
                     'otp_send_rate_limited',
                     'otp_send_rate_limit_error',
                     'otp_verify_succeeded',
                     'otp_verify_failed',
                     'otp_verify_rate_limited',
                     'otp_verify_rate_limit_error'
                   )),
  error_code       text,
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index auth_events_phone_hash_created_at_idx
  on public.auth_events (phone_hash, created_at desc);
create index auth_events_actor_user_id_idx
  on public.auth_events (actor_user_id);
create index auth_events_event_idx
  on public.auth_events (event);

alter table public.auth_events enable row level security;

-- No grants to `authenticated` or `anon` at all: every write goes through
-- the service-role client (which bypasses RLS and grants entirely), and
-- reads are admin-only (system_admin across tenants; tenant_admin has no
-- reliable tenant scope here since tenant_id is usually null, so this is
-- system_admin-only for now rather than a half-working tenant_admin policy).
create policy "system_admin_read_auth_events"
  on public.auth_events for select
  using (public.is_system_admin());

-- No INSERT/UPDATE/DELETE policy at all — default-deny for `authenticated`
-- and `anon` alike, matching audit_events' write-once posture. The
-- service-role client used by log-auth-event.ts bypasses RLS entirely, so
-- this table is effectively write-only-by-service-role, read-only-by-
-- system_admin.
revoke insert, update, delete on public.auth_events from authenticated;
revoke insert, update, delete on public.auth_events from anon;
grant select on public.auth_events to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'auth_events'
--   ORDER BY policyname;
--
-- Expected: system_admin_read_auth_events (SELECT) only.

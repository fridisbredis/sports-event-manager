-- ============================================================================
-- Migration 0035: audit_events table (SEC-07)
-- ============================================================================
--
-- SEC-07 requires structured audit events for admin role changes, tenant
-- changes, invitations, and bulk SMS sends (docs/quality-requirements.md).
-- No audit table has ever existed in this schema. This migration adds one.
--
-- Scope for this migration (see docs/adr — none needed, this is additive
-- and uses the session client, not service-role, so ADR-0001's obligations
-- are not triggered):
--   - role_revoked            (remove_official RPC, migration 0025)
--   - tenant_created / tenant_activated / tenant_deactivated /
--     tenant_tier_changed     (src/app/(system)/admin/actions.ts)
--   - official_invited        (POST /api/officials)
--   - announcement_published  (POST /api/announcements)
--
-- Deliberately NOT covered here (tracked separately, not an oversight):
--   - OTP/login audit events
--   - Role *grant* on invite confirmation (0017/0018) — the actor there is
--     the invited official authenticating via OTP, not an admin, so it
--     doesn't fit actor_role's constraint below. The "official_invited"
--     event already records when the officials row was created.
--
-- All application-level writes go through the session client
-- (createSupabaseServerClient), never the service client — an audit write
-- from an already-authorized route doesn't fit any of ADR-0001's four
-- service-role categories. RLS's own INSERT policy is the real gate,
-- re-deriving the same authorization the app already checked rather than
-- trusting the app alone.
--
-- actor_role and action are check-constrained text, matching this schema's
-- existing "enum" convention (officials.invite_status, sms_queue.status) —
-- no `create type ... as enum` is used anywhere else here either.
--
-- target_type/target_id give a typed pointer to "what was affected"; detail
-- (jsonb) carries anything action-specific. Never put raw PII (e.g. a full
-- phone number) in detail — mirrors the phone-redaction already used in
-- officials/route.ts's rate-limit logging.
--
-- RLS deliberately deviates from the 0004 "for all" convention: audit rows
-- must be write-once for every role, including tenant_admin and
-- system_admin, so INSERT and SELECT are split and there is no UPDATE or
-- DELETE policy at all (default-deny). Do not "fix" this into a single
-- `for all` policy — that would let a tenant_admin edit or erase evidence
-- of their own role changes, which defeats the point of an audit trail.
-- SELECT is also not the usual "tenant_member_read_*" pattern — audit
-- history is an admin-facing security surface, not general tenant-member
-- data, so only tenant_admin (own tenant) and system_admin (all tenants)
-- can read it.
--
-- Forward-fix: additive
--   Rollback: drop table if exists public.audit_events;
--             Safe at any time — no other table FKs to audit_events, no
--             RPC or view depends on it. logAuditEvent() (src/lib/audit) is
--             fail-safe: a missing table just makes every insert fail and
--             get logged via logger.error, same as any other DB-error path
--             already handled. No user-facing behavior regresses.
--   Data:     No data loss beyond the audit rows themselves, which is the
--             intended effect of a rollback. No existing table, column,
--             constraint, or policy is touched.
--   Blast:    Fully additive and isolated. Deploy order in either direction
--             is safe: schema-before-code leaves the table empty and
--             unused; if code somehow shipped before schema, every
--             logAuditEvent() call fails closed without affecting the
--             underlying mutation's response.
--   Window:   Compatible. No lock concerns — new table, no backfill.
-- ============================================================================
--
-- actor_user_id is nullable, not `not null`: the FK is `on delete set null`
-- (keep the audit row, forget the actor once their auth.users row is gone),
-- matching the officials.user_id / participants.user_id precedent in 0001.
-- A `not null` column here would make Postgres abort any auth.users delete
-- that has audit events with 23502 instead of nulling the column as intended.

create table public.audit_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenants(id) on delete set null,
  actor_user_id    uuid references auth.users(id) on delete set null,
  actor_role       text not null check (actor_role in ('system_admin', 'tenant_admin')),
  action           text not null check (action in (
                     'role_revoked',
                     'tenant_created',
                     'tenant_activated',
                     'tenant_deactivated',
                     'tenant_tier_changed',
                     'official_invited',
                     'announcement_published'
                   )),
  target_type      text not null check (target_type in (
                     'user_role', 'tenant', 'official', 'announcement'
                   )),
  target_id        uuid,
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index audit_events_tenant_id_created_at_idx
  on public.audit_events (tenant_id, created_at desc);
create index audit_events_actor_user_id_idx
  on public.audit_events (actor_user_id);
create index audit_events_action_idx
  on public.audit_events (action);

alter table public.audit_events enable row level security;

-- A fresh table created in a migration has no base grants for
-- `authenticated` locally (unlike Supabase's hosted platform, which grants
-- select/insert/update/delete by default — see ADR-0002/migration 0035 on
-- the anon-grants branch). RLS alone is not a substitute for the grant: an
-- authenticated INSERT/SELECT fails with 42501 "permission denied for
-- table" before RLS is even evaluated if the grant is missing — the same
-- bug migration 0032 fixed for sms_queue. UPDATE/DELETE are deliberately
-- never granted here at all (see the revoke below and the "no UPDATE/DELETE
-- policy" note above) — write-once is enforced at the grant layer, not only
-- by the absence of a policy.
grant insert, select on public.audit_events to authenticated;

-- INSERT: actor must be the authenticated caller, and must be tenant_admin
-- of the target tenant or a global system_admin.
create policy "authorized_admin_insert_audit_events"
  on public.audit_events for insert
  with check (
    actor_user_id = auth.uid()
    and (
      public.get_user_role(tenant_id) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

-- SELECT: system_admin reads everything; tenant_admin reads only their own
-- tenant's rows.
create policy "system_admin_read_all_audit_events"
  on public.audit_events for select
  using (public.is_system_admin());

create policy "tenant_admin_read_own_tenant_audit_events"
  on public.audit_events for select
  using (public.get_user_role(tenant_id) = 'tenant_admin');

-- No UPDATE/DELETE policy at all — default-deny. Audit rows are write-once
-- for every role, including tenant_admin and system_admin.
revoke update, delete on public.audit_events from authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'audit_events'
--   ORDER BY policyname;
--
-- Expected: authorized_admin_insert_audit_events (INSERT),
-- system_admin_read_all_audit_events (SELECT),
-- tenant_admin_read_own_tenant_audit_events (SELECT). No UPDATE/DELETE rows.

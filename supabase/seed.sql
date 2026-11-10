-- ============================================================================
-- LOCAL ONLY. Never applied to dev or prod.
-- ============================================================================
--
-- `supabase db push` does not apply seed files, and [db.seed] in config.toml is
-- honoured only by `supabase db reset`. There is no code path by which this
-- file can reach a hosted project.
--
-- WHY THIS EXISTS
--
-- Supabase's hosted platform grants anon/authenticated/service_role DML on the
-- tables in `public` automatically; the migrations never declare it. Newer
-- Supabase CLI versions stopped supplying those grants locally, so a clean
-- `supabase db reset` leaves the three roles with only REFERENCES/TRIGGER/
-- TRUNCATE and PostgREST answers 42501/403 on all 15 tables. The seed scripts,
-- the app's own queries and the whole integration suite fail. Cloud is
-- unaffected, which is why this went unnoticed for a while.
--
-- Migrations 0035/0036 will revoke anon's insert/update/delete grant (see
-- docs/adr/0002-anon-role-default-dml-grants.md) once merged and pushed to
-- dev and prod — verified not yet applied to either as of 2026-08-31. This
-- file mirrors the post-revoke state ahead of that push, so it no longer
-- reproduces every platform default, only the ones still in force.
--
-- See docs/testing/rollback-rehearsal.md (Del 2 fynd 2, Del 3 fynd 1) and
-- F-MNT-09 in docs/quality-requirements.md.
--
-- WHY IT IS NOT A MIGRATION
--
-- Trello: "Grants: lokal build inte körbar utan plattformens defaults". The
-- recorded decision is a session-level grant, deliberately NOT a migration,
-- because the migration suite must stay the source of truth for the schema and
-- must not re-declare privileges the platform owns in cloud.
--
-- A seed file is neither. It keeps that property — local-only, unreachable
-- from `db push` — while removing the manual psql step that otherwise has to
-- be re-run after every reset. Interpretation confirmed by Frida 2026-08-27;
-- the Trello card should be updated with this outcome rather than left open.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
--   * No `grant ... on all tables in schema public`. That would grant on
--     rate_limit_hits and sms_queue and silently undo the REVOKEs in
--     migrations 0026 and 0030, which are security decisions with a test
--     asserting them. Tables are enumerated instead, so the deny-list is
--     never violated and needs no compensating re-revoke.
--
--   * No `grant ... on all routines`. All 14 functions already carry narrow
--     EXECUTE grants in their own migrations (mostly: revoke from
--     public/anon/authenticated, then grant to service_role). A blanket grant
--     would re-expose check_rate_limit, release_rate_limit, get_last_sign_in_at,
--     anonymize_inactive_users and claim_sms_queue_batch to anon. Function
--     privileges are not touched here at all.
--
--   * No `alter default privileges`. This file runs AFTER every migration, so
--     defaults could only affect tables created later in the same reset —
--     of which there are none, ever. Worse, it would start silently covering
--     tables that future migrations add, which is exactly the blanket
--     behaviour the explicit enumeration exists to prevent. A new table
--     should produce a loud local 42501 that forces a conscious decision
--     about whether it belongs on the deny-list.
--
-- KEEP IN SYNC. Adding a table to a migration means either granting in that
-- migration or adding it here. A new table gets anon select only, per 0035 —
-- not insert/update/delete, unless a future decision reverses ADR-0002.
--
-- Of the 17 tables in `public`: 14 are listed below; rate_limit_hits and
-- sms_queue are handled separately (service_role only, see the deny-list note
-- above); and checklist_item_checks, checklist_item_events and
-- official_unavailability carry their own grants in the migrations that create
-- them, which is why they are absent here rather than forgotten.
--
-- user_preferences was forgotten, and that is what this note exists to stop
-- recurring: it was created by migration 20261001102501 with no grants of its
-- own and no entry here, so every local `db reset` left getUserLanguage()
-- failing 42501 and the app silently falling back to English. Hosted Supabase
-- grants automatically, so dev and prod never showed it.
-- ============================================================================

begin;

-- PostgREST needs schema USAGE before any table privilege is reachable. Some
-- CLI versions keep this, some do not — asserting it is cheap.
grant usage on schema public to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The 13 tables with no deny-list decision.
-- ----------------------------------------------------------------------------
-- Full DML for authenticated/service_role, matching what the hosted platform
-- grants. RLS is what gates rows for those two, never grants — see
-- SEC-03 / ADR-0001. anon gets select only, per ADR-0002 / migration 0035:
-- no policy in this schema ever targeted `anon` for select either, so this
-- grants nothing anon can actually use — it exists only to mirror cloud's
-- read grant. anon's insert/update/delete grant was revoked by 0035 (never
-- reviewed as intentional, and no code path relies on it); this file must
-- keep matching that or a clean `supabase db reset` re-grants what 0035
-- removed and local dev stops matching dev/prod.

grant select on table
  public.tenants,
  public.user_roles,
  public.events,
  public.event_stages,
  public.event_distances,
  public.officials,
  public.participants,
  public.assignments,
  public.announcements,
  public.workstations,
  public.workstation_operating_windows,
  public.workstation_todos,
  public.user_preferences
to anon;

grant select, insert, update, delete on table
  public.tenants,
  public.user_roles,
  public.events,
  public.event_stages,
  public.event_distances,
  public.officials,
  public.participants,
  public.assignments,
  public.announcements,
  public.workstations,
  public.workstation_operating_windows,
  public.workstation_todos,
  public.user_preferences
to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Tables that grant in their own migrations.
-- ----------------------------------------------------------------------------
-- checklist_item_checks, checklist_item_events, official_unavailability and
-- official_events (N23, 20261028104200) each grant `authenticated` in the migration that creates them, which is why
-- they are absent from the lists above. Those grants omit service_role,
-- because hosted Supabase supplies it automatically — but a local
-- `supabase db reset` does not, so anything going through the service client
-- (the integration suite, and any server-side read that bypasses RLS by
-- design) fails 42501 locally while working fine on dev and prod.
--
-- Granted here rather than by amending those migrations: they are already
-- applied everywhere, and hosted projects need nothing added.

grant select, insert, update, delete on table
  public.checklist_item_checks,
  public.official_unavailability,
  public.official_events
to service_role;

grant select, insert on table public.checklist_item_events to service_role;


-- ----------------------------------------------------------------------------
-- rate_limit_hits — service_role only.
-- ----------------------------------------------------------------------------
-- Migration 0026 revokes all from anon and authenticated as a backstop against
-- an accidental re-grant, with a deny-all policy layered on top. Both rate
-- limit RPCs are SECURITY DEFINER, so only service_role needs table access.
-- tests/integration/rate-limit.test.ts asserts the anon and authenticated
-- denial directly — do not widen this.

grant select, insert, update, delete on table public.rate_limit_hits
to service_role;

-- ----------------------------------------------------------------------------
-- auth_events — service_role writes, authenticated reads via RLS.
-- ----------------------------------------------------------------------------
-- Migration 0038 (SEC-07) grants authenticated SELECT (gated to system admins
-- by RLS) and revokes writes from anon and authenticated. Every write goes
-- through the service-role client in logAuthEvent() — a failed OTP verify has
-- no session to derive an INSERT policy from (ADR-0001 category 5). The
-- migration never grants service_role, because hosted Supabase does.
--
-- The symptom (B17): every OTP send/verify and invite-confirmation role grant
-- fails its audit write locally with 42501. logAuthEvent() is fail-safe, so
-- login still works and the only trace is a "Failed to write auth event" log
-- line. Dev and prod are unaffected — verified 2026-11-10: service_role holds
-- full DML on auth_events on both, and rows are being written.
-- tests/integration/auth-events-service-role.test.ts pins this grant.

grant select, insert, update, delete on table public.auth_events
to service_role;

-- ----------------------------------------------------------------------------
-- sms_queue — service_role full, authenticated INSERT only, anon nothing.
-- ----------------------------------------------------------------------------
-- Migration 0030 revokes all from anon and authenticated; 0032 restores INSERT
-- to authenticated only, gated by the tenant_admin RLS policy. The SMS worker
-- claims rows via claim_sms_queue_batch, which is granted to service_role only.
-- The INSERT line reproduces 0032's grant in effect — redundant if the CLI
-- leaves 0032 intact, but it makes this file's privilege picture complete
-- rather than differential.

grant select, insert, update, delete on table public.sms_queue
to service_role;

grant insert on table public.sms_queue to authenticated;

-- ----------------------------------------------------------------------------
-- sms_usage — service_role only.
-- ----------------------------------------------------------------------------
-- Migration 20261019093632 (N11) revokes all from anon and authenticated and
-- layers a deny-all policy on top, taking the same posture as sms_queue and
-- rate_limit_hits above. What it does NOT do is grant service_role, because
-- hosted Supabase supplies that automatically — and like the three tables in
-- the section above, a local `supabase db reset` does not.
--
-- The symptom is specific and misleading: every admin dashboard render logs
-- "permission denied for table sms_usage" (42501) with consequence
-- cap_not_enforced_send_allowed, i.e. the N24 SMS cap silently fails open
-- locally, and four tests in sms-usage-accounting.test.ts fail. Dev and prod
-- are unaffected — verified against prod's information_schema on 2026-10-26,
-- where service_role holds full DML on this table.
--
-- Granted here rather than by amending that migration, for the reason the
-- section above gives: it is already applied everywhere, and hosted projects
-- need nothing added.

grant select, insert, update, delete on table public.sms_usage
to service_role;

-- ----------------------------------------------------------------------------
-- sms_cap_warnings — service_role only.
-- ----------------------------------------------------------------------------
-- Migration 20261030084025 (N32) revokes all from anon and authenticated and,
-- like sms_usage above, leaves service_role to the hosted platform's automatic
-- grant — which a local `supabase db reset` does not supply.
--
-- The symptom (B16): sendSmsCapWarnings logs "permission denied for table
-- sms_cap_warnings" (42501) with consequence cap_warnings_skipped_this_tick,
-- returns 0, and the 90% warning never goes out locally. The integration test
-- 'texts the tenant admin and the system admin, not the official, once' in
-- sms-cap-warning.test.ts fails with an empty recipient list. Dev and prod
-- are unaffected — verified 2026-11-10: service_role holds select, insert,
-- update and delete on this table on both.
--
-- All four are needed: the worker reads the month's claims, inserts its own
-- claim, updates it with the send counts, and deletes it when every send
-- failed so the next tick retries.

grant select, insert, update, delete on table public.sms_cap_warnings
to service_role;

commit;

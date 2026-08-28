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
-- KEEP IN SYNC: 15 tables in `public`. 13 are listed below; rate_limit_hits
-- and sms_queue are handled separately. Adding a table to a migration means
-- adding it here too.
-- ============================================================================

begin;

-- PostgREST needs schema USAGE before any table privilege is reachable. Some
-- CLI versions keep this, some do not — asserting it is cheap.
grant usage on schema public to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The 13 tables with no deny-list decision.
-- ----------------------------------------------------------------------------
-- Full DML for all three roles, matching what the hosted platform grants.
-- RLS is what gates rows, never grants — see SEC-03 / ADR-0001. Note that no
-- policy in this schema targets `anon` at all (verified: zero `to anon`
-- occurrences across all migrations), so anon matches no policy and reads zero
-- rows regardless of the grant below.
--
-- anon is included on purpose, for two reasons: it mirrors cloud exactly, and
-- tests/integration/rate-limit.test.ts asserts that anon is *denied* on
-- rate_limit_hits and both rate-limit RPCs. If anon held no grants anywhere,
-- those assertions would pass vacuously and stop testing migration 0026's
-- REVOKE. Granting the 13 tables here keeps the two carve-outs load-bearing.

grant select, insert, update, delete on table
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
to anon, authenticated, service_role;

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

commit;

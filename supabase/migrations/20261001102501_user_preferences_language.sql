-- ============================================================================
-- Migration 20261001102501: per-user language preference
-- ============================================================================
--
-- Adds user_preferences, a one-row-per-user table holding the UI language the
-- user picked. Backs the language switcher that sits in all three layout
-- branches ((tenant)/admin, (official), (system)/admin) plus the invite page.
--
-- WHY A NEW TABLE rather than an existing column.
--
-- officials.* was the obvious candidate and is wrong twice over: the table is
-- per (user_id, tenant_id), so a person holding rows in several tenants would
-- carry a separate language setting in each, and someone who switched language
-- in one tenant would still be in the old one everywhere else. And a global
-- system_admin usually holds no officials row at all (see the access comments
-- in src/lib/auth/tenant.ts) — they reach official surfaces through a global
-- role, so an officials-keyed preference would leave them with nowhere to
-- store a choice.
--
-- auth.users.user_metadata was the second candidate and is also wrong: it is
-- baked into the JWT at sign-in, so a value written with updateUserById() is
-- not visible to getClaims() until the token refreshes. The language would
-- then appear to change at an arbitrary later moment rather than on save. The
-- existing comment in (tenant)/[tenantSlug]/admin/account/page.tsx already
-- records this, which is why that page reads metadata via getUserById()
-- instead of from claims. Reading it that way from every layout would add a
-- GoTrue round trip per render, against the grain of PERF-01's claims-based
-- getCurrentUser().
--
-- A plain table keyed on user_id has neither problem: one row per person,
-- readable with an ordinary query, visible immediately after the write.
--
-- LANGUAGE VALUES. Constrained to the locales the app actually ships
-- (src/lib/i18n/config.ts). English is both the default and the fallback per
-- the product decision of 2026-10-01, so a user with no row here resolves to
-- 'en' in application code — the column is therefore NOT NULL with no default
-- row created at sign-up, and absence means "never chose", not "chose en".
--
-- RLS. Not tenant-scoped, so the 0004 tenant_admin/tenant_member pattern does
-- not apply here — there is no tenant_id to key get_user_role() on. Follows
-- the user-scoped shape already used by user_read_own_role and
-- participant_read_own in 0002 instead: a user may read and write exactly
-- their own row. A SELECT policy is defined alongside the write policies
-- because a write with no matching SELECT policy cannot see the row it
-- targets (the trap hit in 0024).
--
-- No system_admin override clause: this is a personal display preference, not
-- tenant data, and nothing in the app reads another user's language.
--
-- Forward-fix: additive
--   Rollback: drop the table in a new timestamped migration. Safe at any
--             point — nothing else references it, and application code
--             resolves a missing row to the default locale, so dropping it
--             degrades every user to 'en' rather than breaking a read.
--   Data:     no data loss. The table is created empty and holds only a
--             display preference; a dropped row costs the user their language
--             choice, nothing more.
--   Blast:    none for the currently deployed code, which does not know this
--             table exists. If the table were missing or unreadable once the
--             new image is live, getUserLanguage() logs the failed read and
--             falls back to the default locale, so pages render in English
--             rather than erroring.
--   Window:   compatible — a new table nothing deployed reads or writes yet,
--             so the already-running image is unaffected while the schema is
--             live and the new image is not.
-- ============================================================================

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  language text not null check (language in ('en', 'sv')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_preferences is
  'Per-user UI preferences. One row per user, created on first explicit choice — absence means the user has never picked, and application code resolves that to the default locale.';

comment on column public.user_preferences.language is
  'UI language chosen by the user. Constrained to the locales shipped in src/lib/i18n/config.ts. Does not affect SMS, which is always English, or date formatting, which is always sv-SE (see src/lib/i18n/date-locale.ts).';

alter table public.user_preferences enable row level security;

-- Defensive re-run: drop before create, per the project RLS convention.
drop policy if exists user_read_own_preferences on public.user_preferences;
drop policy if exists user_manage_own_preferences on public.user_preferences;

-- SELECT is separate from the FOR ALL policy below on purpose: a row that no
-- SELECT policy makes visible cannot be updated or deleted either, and the
-- upsert path depends on reading the conflicting row.
create policy user_read_own_preferences
  on public.user_preferences for select
  using (user_id = auth.uid());

create policy user_manage_own_preferences
  on public.user_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

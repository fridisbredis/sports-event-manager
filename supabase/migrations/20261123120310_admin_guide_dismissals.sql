-- ============================================================================
-- Migration 20261123120310: remember a hidden onboarding guide per user
-- ============================================================================
--
-- The admin dashboard's onboarding guide (AdminOnboardingGuide) has a "hide
-- the guide" button. Until now the choice was kept in the browser's
-- localStorage under admin-onboarding-dismissed:<eventId>, so it did not follow
-- the person: a new laptop, a second browser, a private window or Safari's
-- storage eviction all brought the guide back. This table moves the choice
-- onto the user.
--
-- ONE ROW PER (USER, EVENT). The guide is per event on purpose: its steps are
-- that event's setup progress, and the copy promises it comes back for the
-- next event ("The guide will appear again when you create another event").
-- So the flag keeps the same key the localStorage entry had, with the user
-- added. A row means "hidden"; no row means "shown". Reopening the guide from
-- Help and guide deletes the row.
--
-- WHY NOT user_preferences. That table is one row per user with language
-- NOT NULL and no default — absence there means "never chose a language". A
-- dismissal-only row would have to invent a language, and a per-event flag
-- does not fit one row per user anyway.
--
-- NOT TENANT-SCOPED IN ITS POLICIES. The row is a personal display choice, the
-- same shape as user_preferences and push_subscriptions: a user reads and
-- manages exactly their own rows. No tenant_id column and no
-- get_user_role()/can_read_event() clause: writing a row for an event you
-- cannot see only hides a guide you would never be shown, and reading returns
-- nothing but your own flags. No system_admin override: nothing reads another
-- user's dismissals.
--
-- CASCADES. Rows go with the auth user and with the event, so neither GDPR
-- anonymization of a deleted user nor deleting an event leaves orphans. The
-- event_id index serves the cascade from events; the primary key already
-- serves the dashboard's (user_id, event_id) lookup.
--
-- Forward-fix: additive
--   Rollback: drop table if exists public.admin_guide_dismissals; in a new
--             timestamped migration. Nothing else references it.
--   Data:     no data loss beyond the flags themselves. A dropped row shows
--             the guide again to someone who had hidden it; one click hides
--             it again.
--   Blast:    none for the currently deployed code, which does not know this
--             table exists. If it were missing or unreadable once the new
--             image is live, the dashboard logs the failed read and shows the
--             guide, and hiding it fails with a visible error; the rest of
--             the dashboard is unaffected.
--   Window:   compatible — a new table nothing deployed reads or writes yet.
-- ============================================================================

create table if not exists public.admin_guide_dismissals (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists admin_guide_dismissals_event_id_idx
  on public.admin_guide_dismissals (event_id);

comment on table public.admin_guide_dismissals is
  'One row per (user, event) where the user hid the admin dashboard onboarding guide. No row means the guide is shown.';

-- Explicit grants, same as push_subscriptions (20261029134922): a local
-- `supabase db reset` does not add them by itself, and a missing grant fails
-- 42501 before RLS is evaluated (see the KEEP IN SYNC note in seed.sql).
-- authenticated: the dashboard and /api/account/onboarding-guide use the RLS
-- client; the policies below gate the rows. service_role: for operational
-- cleanup only, nothing in the app uses it here. anon: nothing.
grant select, insert, delete on public.admin_guide_dismissals to authenticated;
grant select, insert, update, delete on public.admin_guide_dismissals to service_role;

alter table public.admin_guide_dismissals enable row level security;

drop policy if exists user_read_own_admin_guide_dismissals on public.admin_guide_dismissals;
drop policy if exists user_manage_own_admin_guide_dismissals on public.admin_guide_dismissals;

-- SELECT sits alongside the write policy because a write with no matching
-- SELECT policy cannot see the row it targets (the trap hit in 0024), and the
-- upsert on (user_id, event_id) has to read the conflicting row.
create policy user_read_own_admin_guide_dismissals
  on public.admin_guide_dismissals for select
  using (user_id = auth.uid());

create policy user_manage_own_admin_guide_dismissals
  on public.admin_guide_dismissals for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

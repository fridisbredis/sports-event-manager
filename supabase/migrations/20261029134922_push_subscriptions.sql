-- ============================================================================
-- Migration 20261029134922: web push subscriptions
-- ============================================================================
--
-- N31. Stores one Web Push subscription per device a user has enabled
-- notifications on. The browser's PushManager hands back an endpoint (a URL at
-- Apple's, Google's or Mozilla's push service) and two keys; the server needs
-- all three to encrypt and deliver a message to that device.
--
-- Push is sent IN ADDITION to SMS, never instead of it (decided 2026-10-29), so
-- nothing about the SMS path reads this table. A user with no row here simply
-- gets the SMS alone.
--
-- ONE ROW PER DEVICE, NOT PER USER. A person may enable notifications on a
-- phone and a laptop; each has its own endpoint. endpoint is UNIQUE because
-- the push service issues it per browser install: re-subscribing on the same
-- device returns the same endpoint, so the app upserts on it rather than
-- piling up duplicates.
--
-- NOT TENANT-SCOPED. A device belongs to a person, not to a club, so the 0004
-- tenant_admin/tenant_member pattern does not apply — there is no tenant_id to
-- key get_user_role() on. Same user-scoped shape as user_preferences
-- (20261001102501): a user reads and manages exactly their own rows. Which
-- tenant's announcement reaches which device is decided by the sender through
-- officials.user_id, not stored here.
--
-- A SELECT policy sits alongside the write policy because a write with no
-- matching SELECT policy cannot see the row it targets (the trap hit in 0024),
-- and the upsert on endpoint has to read the conflicting row.
--
-- No system_admin override: nothing in the app reads another user's devices.
-- The sender runs as service_role, which bypasses RLS.
--
-- GDPR. The endpoint identifies a device at a third-party push service, so it
-- is personal data. Rows go with the auth user (on delete cascade). KNOWN GAP,
-- follow-up on N31: anonymize_inactive_users() nulls officials.user_id after
-- 24 months but does not delete the auth user, so rows here outlive it. They
-- can no longer be reached by any announcement (the sender resolves recipients
-- through officials.user_id), but they are still stored. To be closed by
-- extending that function in its own replace migration.
--
-- Forward-fix: additive
--   Rollback: drop table if exists public.push_subscriptions; in a new
--             timestamped migration. Nothing else references it.
--   Data:     no data loss beyond the subscriptions themselves. A dropped row
--             costs the user their push opt-in on that device; they re-enable
--             it with one tap, and SMS keeps arriving either way.
--   Blast:    none for the currently deployed code, which does not know this
--             table exists. If it were missing once the new image is live,
--             enabling notifications fails with a visible error and nothing
--             else is affected.
--   Window:   compatible — a new table nothing deployed reads or writes yet.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- Shown back to the user so they can tell their devices apart; never used
  -- for delivery.
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The sender looks subscriptions up by user (announcement -> officials.user_id
-- -> devices). The UNIQUE on endpoint already indexes the upsert path.
create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

comment on table public.push_subscriptions is
  'N31: one Web Push subscription per device a user enabled notifications on. Push is sent in addition to SMS, never instead of it.';

-- Explicit grants, same as official_events (20261028104200). Hosted Supabase
-- adds these by itself, but a local `supabase db reset` does not, and a
-- missing grant fails 42501 before RLS is even evaluated — the trap
-- user_preferences fell into (see the KEEP IN SYNC note in seed.sql).
-- authenticated: the app's RLS client; the policies below gate the rows.
-- service_role: the announcement sender, which looks devices up by user.
-- anon: nothing — 0036's default privileges already withhold DML, and no
-- signed-out flow touches this table.
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

alter table public.push_subscriptions enable row level security;

drop policy if exists user_read_own_push_subscriptions on public.push_subscriptions;
drop policy if exists user_manage_own_push_subscriptions on public.push_subscriptions;

create policy user_read_own_push_subscriptions
  on public.push_subscriptions for select
  using (user_id = auth.uid());

create policy user_manage_own_push_subscriptions
  on public.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

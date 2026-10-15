-- ============================================================================
-- Migration 20261015122103: user_roles.created_at, for the per-tier admin cap
-- ============================================================================
--
-- N20. Tenant admins get a maximum per tier (standard 1, premium 3,
-- professional 10). On downgrade, admins keep access "in the order they were
-- added" — only the first N by timestamp may still log in.
--
-- That rule needs a timestamp, and `user_roles` has never had one: the table
-- is (id, user_id, tenant_id, role) from migration 0001 and nothing has added
-- a column since. This migration adds it and backfills it.
--
-- WHY BACKFILL FROM officials.created_at RATHER THAN now()
-- Defaulting every existing row to now() would make all of a tenant's admins
-- simultaneous, and the downgrade rule would then pick arbitrarily among them
-- — the exact failure the rule exists to avoid. Every tenant-scoped role row
-- in prod has a matching `officials` row (verified 2026-10-15: 23 of 23), and
-- that row's created_at is when the person was actually invited, which is the
-- closest truthful record of "when they were added" that exists anywhere.
--
-- So: backfill from the matching officials row where there is one, and fall
-- back to the auth user's created_at otherwise. The fallback matters for
-- system_admin rows, which have tenant_id IS NULL and no officials row — they
-- are outside the cap entirely (it is per tenant), but the column is NOT NULL
-- so they still need a value.
--
-- For Viadal's three existing admins this reconstructs the real order: Peter
-- Thörn (2026-07-07 13:33:47), Lotta Thörn (13:34:08), Frida Bredberg
-- (2026-09-28). Viadal is professional (cap 10), so nobody is locked out by
-- this backfill today — the ordering only becomes load-bearing if that tenant
-- is ever downgraded.
--
-- WHY A PLAIN COLUMN AND NOT A SEQUENCE
-- "The first N by timestamp" is what the card specifies, and a timestamp is
-- also what a human reads in SYS-02 ("added 7 Jul"). Two rows added in the
-- same microsecond would tie; the cap query breaks that tie on `id` so the
-- order is total and stable rather than arbitrary per query.
--
-- NOT NULL WITH A DEFAULT, NOT NULLABLE
-- A nullable column would mean every reader has to decide what a null sorts
-- as, and `order by created_at` would put nulls last in Postgres — silently
-- treating the oldest rows as the newest, which inverts the cap. Added
-- nullable, backfilled, then set NOT NULL, so no row can exist without one.
--
-- Forward-fix: additive
--   Rollback: alter table public.user_roles drop column if exists created_at;
--   Data:     no data loss on rollback — the column is new, and nothing else
--             reads it until the N20 app code lands. The reconstructed
--             ordering would be lost and could not be recovered a second
--             time if the officials rows are gone by then.
--   Blast:    none on its own. Existing queries select named columns and do
--             not break on a new one. The cap is not enforced by this
--             migration — it only supplies the timestamp the app will order
--             by.
--   Window:   compatible — additive, old code keeps working unmodified.
-- ============================================================================

alter table public.user_roles
  add column if not exists created_at timestamptz;

-- Backfill: the matching officials row first, the auth user's own created_at
-- as fallback, and now() only if both are somehow absent (no such row exists
-- in prod or dev today; it is here so the NOT NULL below cannot fail).
--
-- `min(o.created_at)`: a re-invited person can have more than one officials
-- row for the same (tenant, user) — removal is a soft delete (invite_status
-- 'removed'), so 0020's unique index deliberately does not cover them. The
-- earliest is when they were first added, which is what the ordering wants.
update public.user_roles r
set created_at = coalesce(
  (
    select min(o.created_at)
    from public.officials o
    where o.user_id = r.user_id
      and o.tenant_id = r.tenant_id
  ),
  (select u.created_at from auth.users u where u.id = r.user_id),
  now()
)
where r.created_at is null;

alter table public.user_roles
  alter column created_at set not null,
  alter column created_at set default now();

comment on column public.user_roles.created_at is
  'N20: when this role was granted. Orders the per-tier tenant_admin cap — on '
  'downgrade only the first N admins by (created_at, id) keep access. '
  'Backfilled from the matching officials row (when the person was invited), '
  'falling back to auth.users.created_at for system_admin rows, which have '
  'tenant_id IS NULL and sit outside the cap.';

-- Supports the cap query: "this tenant's admins, oldest first".
create index if not exists user_roles_tenant_role_created_at_idx
  on public.user_roles (tenant_id, role, created_at, id);

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select tenant_id, role, created_at from public.user_roles
--   where role = 'tenant_admin' order by tenant_id, created_at, id;

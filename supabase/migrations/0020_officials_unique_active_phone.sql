-- ---------------------------------------------------------------------------
-- Migration 0020: one active official per phone number within a tenant
-- ---------------------------------------------------------------------------
--
-- Officials in the same tenant may share a NAME — real rosters contain two
-- people called the same thing. They must not share a PHONE NUMBER.
--
-- The phone is the identity the invite confirmation binds against:
--   * 0017 looks the official up by token, then compares the confirming
--     user's verified auth.users.phone to officials.phone
--   * 0018 looks the official up by phone alone, with no tenant filter and
--     no `strict`/`limit`, so two matching rows would bind one arbitrarily
--
-- Two active officials sharing a number therefore makes that binding
-- ambiguous. This index removes the ambiguity at the source.
--
-- Why partial, excluding 'removed':
--   Removal is a soft delete — the row stays with invite_status = 'removed'
--   and the officials page filters it out of the list entirely. A blanket
--   unique constraint would reject a number because of a row the admin
--   cannot see anywhere in the UI, with no way to resolve it without
--   database access. Excluding removed rows frees the number for re-use.
--
-- Prerequisite: rows that already violate this must be resolved first, or
-- the index will fail to create. To find them:
--
--   select tenant_id, phone, count(*), array_agg(id)
--   from public.officials
--   where invite_status <> 'removed'
--   group by tenant_id, phone
--   having count(*) > 1;
--
-- Resolve by setting the surplus rows to invite_status = 'removed' (the same
-- state the DELETE route produces). Do NOT hard-delete without checking for
-- dependent assignments first.
--
-- Run on BOTH dev and prod Supabase projects.
--
-- ORDERING — deploy the code BEFORE creating this index, not after:
--   The POST /api/officials route translates a unique violation (SQLSTATE
--   23505) into a 409 "An official with this phone number already exists".
--   That handler shipped with this migration. If the index exists while an
--   older build is running, the same duplicate surfaces as an unhandled 500.
--   The route also pre-checks for duplicates before inserting, so deploying
--   the code without the index is a safe intermediate state; the reverse is
--   not. Code first, index second.
--
-- Verify after running:
--
--   select indexname from pg_indexes
--   where tablename = 'officials' and indexname like '%phone%';
--
--   Expect officials_tenant_phone_active_uniq. "Success. No rows returned"
--   from the CREATE is normal DDL output and is not by itself confirmation.
--
-- Applied:
--   dev  (lhflutwvwvzawzbcuwup) — 2026-08-17, zero duplicates found, verified
--   prod — applied (confirmed by Frida, 2026-08-28)
-- ---------------------------------------------------------------------------

create unique index if not exists officials_tenant_phone_active_uniq
  on public.officials (tenant_id, phone)
  where invite_status <> 'removed';

comment on index public.officials_tenant_phone_active_uniq is
  'One active official per phone number per tenant. Excludes soft-deleted '
  '(invite_status = ''removed'') rows so a removed official''s number can be '
  're-used. Names are deliberately not constrained.';

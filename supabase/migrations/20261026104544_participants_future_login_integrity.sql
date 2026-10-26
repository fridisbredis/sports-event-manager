-- ============================================================================
-- Migration 20261026104544: participants.user_id integrity (N21, for PART-02)
-- ============================================================================
--
-- Closes the gap between participants.user_id and the officials table it was
-- modelled on. The column has existed since migration 0001 and carries no
-- foreign key, no uniqueness and no index — officials.user_id has all three.
--
-- PARTICIPANT LOGIN IS NOT BUILT, AND THIS DOES NOT BUILD IT. The card is
-- explicit that phone linking is Peter's to design ("import without phone
-- numbers now, phone linking later"), and no participant can sign in today:
-- Race Results does not expose phone numbers and SMS OTP is the only method
-- we have. What this migration does is make sure the column that flow will
-- hang off cannot be populated incorrectly before the flow exists.
--
-- WHY NOW RATHER THAN WITH THAT FLOW. participants holds ZERO rows in prod
-- (checked 2026-10-26), so every constraint below is free: nothing to
-- backfill, nothing that can fail validation, no risk of discovering a
-- duplicate link in live data. That window closes the moment the first real
-- start list is imported — after which adding a UNIQUE constraint means
-- first proving no two rows already share a user_id, and a FOREIGN KEY means
-- proving every user_id still exists in auth.users. Doing it now costs
-- nothing; doing it later is a data-cleanup exercise.
--
-- Deliberately NOT included: an RLS policy letting a participant read their
-- own participant_stages rows. participant_read_own already covers the
-- participants row itself, but a policy for a role that cannot authenticate
-- is untestable — it would be written against guesses about a flow Peter has
-- not designed, and would have to be rewritten when he does. The table is
-- reachable by tenant_admin today, which is all PART-01 needs.
--
-- Forward-fix: additive
--   Rollback:
--     ALTER TABLE public.participants
--       DROP CONSTRAINT IF EXISTS participants_user_id_fkey;
--     DROP INDEX IF EXISTS public.participants_user_id_key;
--     DROP INDEX IF EXISTS public.participants_user_id_idx;
--   Data:     no data loss. Every object here is a constraint or an index;
--             none rewrites a row. prod holds 0 participants and no row
--             anywhere has a non-null user_id, so nothing can fail to
--             validate on the way in either.
--   Blast:    nothing. No deployed code writes participants.user_id —
--             participant login does not exist, and the N21 import never
--             touches the column (asserted in
--             tests/integration/import-participants.test.ts). A future
--             writer that tried to link one user to two participant rows,
--             or to a deleted auth user, would now get 23505/23503 instead
--             of silently creating a split identity.
--   Window:   compatible in both directions. Currently-deployed code never
--             sets this column, so the new constraints cannot reject a
--             write it makes. The FK is ON DELETE SET NULL, matching
--             officials: deleting an auth user unlinks the participant
--             rather than deleting their race entry, which is the right
--             outcome — the entry is a fact about the race, not about the
--             account.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Foreign key to auth.users, matching officials_user_id_fkey (0001).
--
--    ON DELETE SET NULL, not CASCADE: a participant row records that someone
--    entered the race. Removing their login should drop the link, never the
--    entry — the bib, class and club remain true after the account is gone,
--    and the admin roster would otherwise lose rows it still needs.
--
--    (user_roles uses CASCADE for the opposite reason: a role row IS the
--    account's membership and means nothing without it.)
-- ----------------------------------------------------------------------------

ALTER TABLE public.participants
  DROP CONSTRAINT IF EXISTS participants_user_id_fkey;

ALTER TABLE public.participants
  ADD CONSTRAINT participants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 2. One account links to at most one participant row.
--
--    officials has no such constraint, and that is not a precedent worth
--    copying: an official is invited by a human who types a phone number, so
--    a duplicate is visible in the roster. A participant will be linked by an
--    automated phone match against an imported list, where the same person
--    appearing twice (two entries, a re-import, a corrected bib) is exactly
--    the case that produces a silent split identity — two rows, one account,
--    and a personal schedule that shows half their races.
--
--    Partial, because user_id is NULL for every participant today and will
--    stay NULL for anyone who never signs in. A plain UNIQUE would also
--    permit that (NULLs do not conflict in Postgres), but spelling the
--    predicate out states the intent and keeps the index small.
--
--    NOT scoped per tenant on purpose: one auth user is one person, and the
--    same person entered in two tenants' races should resolve to two
--    participant rows only if those are genuinely separate entries. If a
--    cross-tenant participant identity is ever wanted, that is a design
--    decision to take deliberately — this constraint makes it impossible to
--    arrive at by accident.
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS participants_user_id_key
  ON public.participants (user_id)
  WHERE user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. The index participant_read_own needs.
--
--    That policy (migration 0002) filters on `user_id = auth.uid()`, so
--    every read a signed-in participant makes of their own row scans the
--    table without this. Same gap F-PERF-03 found and fixed on officials
--    (officials_user_id_idx) — participants was never given the equivalent.
--
--    The unique index above would serve the lookup on its own, but it is
--    partial, so a planner considering a query that does not repeat the
--    `user_id IS NOT NULL` predicate cannot use it. This one is
--    unconditional and small (one entry per linked participant).
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS participants_user_id_idx
  ON public.participants (user_id);

COMMENT ON COLUMN public.participants.user_id IS
  'The auth user this participant signs in as, or NULL. NULL for every row '
  'today: participant login does not exist yet (the `participant` role is in '
  'the user_roles CHECK and resolvePostLoginRedirect routes it, but the '
  'route itself is unbuilt), and an imported participant has no phone number '
  'to authenticate with. Constrained by migration 20261026104544 so the '
  'future linking flow cannot create a split identity: FK to auth.users with '
  'ON DELETE SET NULL (losing the account unlinks the entry, never deletes '
  'it), and unique among non-null values. The N21 import never writes this '
  'column — see import_participants.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with (db push matches on the version prefix and skips a colliding
-- migration SILENTLY — check the catalog, not the push log):
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.participants'::regclass AND contype = 'f';
--   -- expect participants_user_id_fkey ... ON DELETE SET NULL
--
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public' AND tablename = 'participants'
--     AND indexname IN ('participants_user_id_key', 'participants_user_id_idx');
--   -- expect 2 rows
--
--   -- The constraint actually bites (expect 23505 on the second insert):
--   --   INSERT INTO participants (tenant_id, name, user_id) VALUES (t, 'A', u);
--   --   INSERT INTO participants (tenant_id, name, user_id) VALUES (t, 'B', u);
-- ============================================================================

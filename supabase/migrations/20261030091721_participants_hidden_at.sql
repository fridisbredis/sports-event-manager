-- ============================================================================
-- Migration 20261030091721: participants.hidden_at (N34 / PART-01)
-- ============================================================================
--
-- An admin can hide a participant from the PART-01 roster by hand and
-- unhide them again. Peter's answer on N26 (2026-10-29): striking someone
-- by hand means HIDE ONLY — it does not mean they are not racing. So a
-- hidden participant still receives participant announcements and is still
-- part of the event; they are only left out of the default roster view.
--
-- WHY A NEW COLUMN AND NOT withdrawn_at. import_participants clears
-- withdrawn_at for everyone present in the Race Results response — that is
-- how a re-entered runner comes back. If a manual hide reused withdrawn_at,
-- the next import would silently un-hide the person. The two states have
-- different owners: withdrawn_at belongs to the import ("absent from the
-- latest list"), hidden_at belongs to the admin. import_participants names
-- the columns it writes explicitly (migration 20261028103213), so a new
-- column is untouched by it without any change to the function body.
--
-- A timestamp rather than a boolean, matching withdrawn_at: it costs
-- nothing and answers "since when" if anyone asks.
--
-- No index: the roster query is already narrowed by event_id, and an
-- event holds tens to low hundreds of participants.
--
-- Forward-fix: additive (new nullable column, no default, no backfill)
--   Rollback: alter table public.participants drop column if exists hidden_at;
--   Data:     no data loss beyond the hide flags themselves. Dropping the
--             column un-hides everyone, which is the safe direction —
--             a hidden participant reappears on the roster.
--   Blast:    nothing before the new image ships. After it, dropping the
--             column makes the roster query fail (it selects hidden_at).
--   Window:   compatible. Deployed code neither selects nor writes the
--             column, and no RPC's return shape changes.
-- ============================================================================

alter table public.participants
  add column if not exists hidden_at timestamptz;

comment on column public.participants.hidden_at is
  'N34: set when a tenant admin hides the participant from the PART-01 roster; '
  'NULL when visible. Display only — a hidden participant is still entered and '
  'still receives announcements. Never written by import_participants, unlike '
  'withdrawn_at, which the import owns.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with (db push matches on the version prefix and skips a colliding
-- migration SILENTLY — check the catalog, not the push log):
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'participants'
--     and column_name = 'hidden_at';
--   -- expect one row: timestamp with time zone, YES
-- ============================================================================

-- ============================================================================
-- Migration 20261026084206: participants import model (N21 / PART-01)
-- ============================================================================
--
-- Makes the participants table able to hold an imported Race Results start
-- list. Three things change: the two NOT NULL columns that block an import
-- without phone numbers are relaxed, the core fields the card names are
-- added, and a stage link table gives a participant several Race stages.
--
-- WHY phone BECOMES NULLABLE. Peter chose path 2 from the spike
-- (docs/spikes/raceresults-participant-import.md): import without phone
-- numbers now, phone linking later. Race Results does not expose phone
-- numbers publicly, so not one imported row could be written while the
-- column is NOT NULL. The card says "phone (always present, empty until
-- filled)", which describes the FIELD IN THE UI — the column is always
-- shown, never hidden — not a NOT NULL constraint. NULL is used rather
-- than DEFAULT '': an empty string would be a lie to the
-- get_user_id_by_phone lookups and to the future phone-linking flow, and
-- would collide with itself if phone is ever indexed uniquely. NULL means
-- "unknown", which is exactly what it is. The UI renders an empty field
-- either way.
--
-- WHY name BECOMES NULLABLE TOO — this fixes a latent bug rather than
-- serving the import. anonymize_inactive_users() (migration 0029) runs
-- `update public.participants set name = null, phone = null` against a
-- table where both are NOT NULL. Verified against the live deployed
-- function body in dev, not only the migration file. It has never fired
-- because its where-clause requires p.user_id is not null and no
-- participant has ever had a user_id — participant login does not exist.
-- Relaxing phone alone would remove half the fault and leave the other
-- half waiting for the day participant login lands. Same table, same
-- migration, same reasoning: fix both here.
--
-- WHY A LINK TABLE RATHER THAN stage_id ON THE ROW. Decided by Peter
-- 2026-10-20, answering the card's question 2: "one entry, two stages."
-- A person entered in several Race stages is ONE participant with several
-- stage links, not a duplicated row per stage. This is the model that
-- carries a future user account and phone link without a second migration,
-- and it makes deduplication at import a property of the key rather than
-- something the importer has to reason about.
--
-- WHY external_id IS THE UPSERT KEY, NOT bib. Verified against the live
-- Race Results API on 2026-10-26, not assumed: the participants list
-- returns a DataFields array that includes "ID" alongside "BIB", and for
-- Viadal (event 361004) all 42 rows carry a distinct ID. ID and BIB are
-- plainly different identities — BIB ranges 1..747 while ID ranges 2..48,
-- so BIB is the assigned race number and ID is Race Results' own row
-- identity. The spike listed only the six visible columns and missed ID
-- entirely, which is why the plan hedged on whether a stable key existed.
-- It does. bib would have been the wrong key regardless: race numbers are
-- reused across stages, and the card merges every stage into one list.
--
-- Forward-fix: additive
--   Rollback: a new migration reversing this one, in this order:
--               DROP TABLE IF EXISTS public.participant_stages;
--               DROP INDEX IF EXISTS public.participants_rr_identity;
--               ALTER TABLE public.participants
--                 DROP COLUMN IF EXISTS club,
--                 DROP COLUMN IF EXISTS nation,
--                 DROP COLUMN IF EXISTS gender,
--                 DROP COLUMN IF EXISTS source,
--                 DROP COLUMN IF EXISTS external_id,
--                 DROP COLUMN IF EXISTS extra,
--                 DROP COLUMN IF EXISTS withdrawn_at;
--             The two NOT NULLs are deliberately NOT restored by that
--             rollback: re-adding them fails outright if any row has a
--             null name or phone, and restoring them would reinstate the
--             anonymize_inactive_users() bug described above. Leave them
--             nullable.
--   Data:     no data loss. participants holds 0 rows in prod and 0 in
--             dev, so nothing is rewritten and the relaxation cannot
--             strand an existing row. Dropping the new columns in a
--             rollback would lose whatever has been imported by then;
--             that is recoverable by re-running the import, which is
--             idempotent on (tenant_id, external_id).
--   Blast:    nothing. No deployed code reads or writes any of these
--             columns — race_results_url appears only in
--             src/types/database.ts, and no app code touches participants
--             at all today. The table is reachable only by tenant_admin
--             via RLS and has no UI.
--   Window:   compatible in both directions. Every added column is
--             nullable or defaulted, so currently-deployed code that
--             never mentions them keeps working unchanged. DROP NOT NULL
--             only widens what the column accepts — it cannot fail an
--             insert that used to succeed. The new table is additive and
--             unreferenced by live code. No RPC body changes here, so
--             there is no return-shape contract to preserve.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Relax the two NOT NULL columns.
--
--    phone: required by the import (path 2, no phone numbers).
--    name:  fixes the latent anonymize_inactive_users() bug. See header.
-- ----------------------------------------------------------------------------

ALTER TABLE public.participants ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN name  DROP NOT NULL;

COMMENT ON COLUMN public.participants.phone IS
  'Nullable since migration 20261026084206 (N21). NULL means "unknown" — a '
  'participant imported from Race Results has no phone number, because the '
  'API does not expose one. Deliberately NULL rather than an empty string, '
  'which would be a false value for the phone lookups and for the future '
  'phone-linking flow. Also required by anonymize_inactive_users() (0029), '
  'which sets this column to null.';

COMMENT ON COLUMN public.participants.name IS
  'Nullable since migration 20261026084206 (N21). Relaxed so that '
  'anonymize_inactive_users() (0029) — which sets name = null — cannot fail '
  'against the constraint on the day participant login exists and a '
  'participant row first carries a user_id.';

-- ----------------------------------------------------------------------------
-- 2. The core fields the card names, plus the import bookkeeping columns.
--
--    `category` already exists (0001) and carries the card's "class"
--    (Race Results AGEGROUP.NAME) — no rename needed.
-- ----------------------------------------------------------------------------

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS club        text,
  ADD COLUMN IF NOT EXISTS nation      text,
  ADD COLUMN IF NOT EXISTS gender      text,
  ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS extra       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;

ALTER TABLE public.participants
  DROP CONSTRAINT IF EXISTS participants_source_check;

ALTER TABLE public.participants
  ADD CONSTRAINT participants_source_check
  CHECK (source IN ('manual', 'race_results'));

-- A row that came from Race Results must carry the identity it was keyed
-- by; a manual row must not pretend to have one. This is what keeps the
-- import from ever adopting (or withdrawing) a hand-entered participant.
ALTER TABLE public.participants
  DROP CONSTRAINT IF EXISTS participants_external_id_matches_source;

ALTER TABLE public.participants
  ADD CONSTRAINT participants_external_id_matches_source
  CHECK (
    (source = 'race_results' AND external_id IS NOT NULL)
    OR (source = 'manual' AND external_id IS NULL)
  );

COMMENT ON COLUMN public.participants.source IS
  '''manual'' | ''race_results'' — which writer owns this row. The import '
  'only ever touches ''race_results'' rows: a manually added participant is '
  'never updated, never withdrawn and never deleted by an import run. This '
  'is the meaning of the card''s "Manual entries get a separate ID series".';

COMMENT ON COLUMN public.participants.external_id IS
  'Race Results'' own row identity, from the ID field of the participants '
  'list response (NOT the bib — verified 2026-10-26 against event 361004, '
  'where bib ranges 1..747 and ID ranges 2..48). The upsert key for '
  're-import, unique per tenant among race_results rows. NULL for manual '
  'rows, enforced by participants_external_id_matches_source.';

COMMENT ON COLUMN public.participants.nation IS
  'ISO country code such as ''IS'' or ''SE''. Normalised in the app layer '
  'from the Race Results NATION.FLAG value, which arrives as an image '
  'reference like ''[img:/graphics/flags/IS.svg]'' rather than a code.';

COMMENT ON COLUMN public.participants.extra IS
  'Race Results fields beyond the core columns, kept verbatim so a list '
  'whose field set differs between races loses nothing. Rendered read-only '
  'as text. The card says "No add column function": a key in here is never '
  'promoted to a real column by an admin action.';

COMMENT ON COLUMN public.participants.withdrawn_at IS
  'Set when a row that previously came from Race Results is absent from a '
  'later import of the same stage — the participant was struck from the '
  'start list. The row is kept, never deleted: a deletion is not '
  'recoverable if the import ran against the wrong race or a truncated '
  'response, and a struck participant can return, in which case this is '
  'set back to NULL. Same keep-the-row-flag-the-state approach as '
  'remove_official (0025) and the GDPR anonymisation (0029).';

-- ----------------------------------------------------------------------------
-- 3. The upsert key.
--
--    Unique on external_id per TENANT, not per (tenant, stage): Peter's
--    answer to question 2 is one participant row with several stage links,
--    so the same Race Results ID appearing in two stages must resolve to
--    the same row rather than conflicting with itself.
--
--    Partial, because manual rows have a NULL external_id and several of
--    them per tenant is the normal case.
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS participants_rr_identity
  ON public.participants (tenant_id, external_id)
  WHERE source = 'race_results';

-- The roster list reads per tenant and filters out withdrawn rows by
-- default; the single-column (tenant_id) index from 0001 stays as the
-- general case.
CREATE INDEX IF NOT EXISTS participants_tenant_withdrawn_idx
  ON public.participants (tenant_id, withdrawn_at);

-- ----------------------------------------------------------------------------
-- 4. The stage link table — "one entry, two stages" (Peter, 2026-10-20).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.participant_stages (
  participant_id uuid        NOT NULL REFERENCES public.participants(id)  ON DELETE CASCADE,
  stage_id       uuid        NOT NULL REFERENCES public.event_stages(id)  ON DELETE CASCADE,
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id)       ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, stage_id)
);

-- tenant_id is denormalised onto this table on purpose: the RLS policies
-- below filter on it directly, so a policy check never has to join back to
-- participants. Same shape the other tenant-scoped tables use.
CREATE INDEX IF NOT EXISTS participant_stages_tenant_stage_idx
  ON public.participant_stages (tenant_id, stage_id);

COMMENT ON TABLE public.participant_stages IS
  'Which Race stages a participant is entered in. Peter decided 2026-10-20 '
  '(card N21, question 2) that a person running several stages is ONE '
  'participant with several stage links rather than one row per stage, so '
  'that a future user account and phone number attach to a single identity. '
  'Rows are written by the import per stage and by the manual add form.';

-- ----------------------------------------------------------------------------
-- 5. RLS on the new table.
--
--    Follows the mandatory convention in .claude/CLAUDE.md: the manage
--    policy carries `OR public.is_system_admin()`, without which a system
--    admin cannot reach a tenant where they hold no user_roles row.
--
--    There is deliberately NO participant-facing read policy here. The
--    matching one on participants (participant_read_own) keys on
--    user_id = auth.uid(), and no participant has a user_id yet —
--    participant login does not exist. Adding a policy for a role that
--    cannot authenticate would be untestable and would have to be
--    rewritten when that login is designed.
-- ----------------------------------------------------------------------------

ALTER TABLE public.participant_stages ENABLE ROW LEVEL SECURITY;

-- Table grants are a SEPARATE gate from RLS, and a new table gets none by
-- default: RLS decides which ROWS a role may touch, but without a GRANT
-- the role cannot touch the table at all and PostgREST answers 42501
-- ("permission denied for table"). Mirrors what participants itself
-- carries, read from information_schema rather than assumed.
--
-- anon is deliberately NOT granted anything, matching migration 0035
-- (revoke anon table DML): nothing here is reachable without a session.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_stages TO service_role;

DROP POLICY IF EXISTS tenant_admin_manage_participant_stages ON public.participant_stages;

CREATE POLICY tenant_admin_manage_participant_stages
  ON public.participant_stages
  FOR ALL
  USING (
    public.get_user_role(tenant_id) = 'tenant_admin'
    OR public.is_system_admin()
  )
  WITH CHECK (
    public.get_user_role(tenant_id) = 'tenant_admin'
    OR public.is_system_admin()
  );

-- ----------------------------------------------------------------------------
-- 6. Spell out WITH CHECK on the existing participants policy.
--
--    The policy is FOR ALL with only USING today. Postgres falls back to
--    USING as the insert/update check when WITH CHECK is absent, so this
--    changes no behaviour — but the table is about to become genuinely
--    writable for the first time, and the rule a write is held to should
--    be written down rather than inherited implicitly.
--
--    USING is restated verbatim from the live policy (read from pg_policies
--    on dev, 2026-10-26), which already carries the is_system_admin() OR
--    clause that migration 0002's file predates.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_admin_manage_participants ON public.participants;

CREATE POLICY tenant_admin_manage_participants
  ON public.participants
  FOR ALL
  USING (
    public.get_user_role(tenant_id) = 'tenant_admin'
    OR public.is_system_admin()
  )
  WITH CHECK (
    public.get_user_role(tenant_id) = 'tenant_admin'
    OR public.is_system_admin()
  );

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with (db push matches on the version prefix and skips a colliding
-- migration SILENTLY — always check the schema itself, never the push log):
--
--   SELECT column_name, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'participants'
--     AND column_name IN ('name', 'phone');
--   -- expect both YES
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'participants'
--     AND column_name IN ('club','nation','gender','source','external_id',
--                         'extra','withdrawn_at');
--   -- expect 7 rows
--
--   SELECT to_regclass('public.participant_stages');  -- expect non-null
--
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public' AND indexname = 'participants_rr_identity';
--
--   SELECT policyname, with_check FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('participants', 'participant_stages');
--   -- expect with_check populated on both manage policies
--
--   -- Grants are a separate gate from RLS; without them PostgREST answers
--   -- 42501 even though the policy would have allowed the row.
--   SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'participant_stages'
--     AND grantee IN ('authenticated', 'anon')
--   GROUP BY grantee;
--   -- expect authenticated to carry SELECT/INSERT/UPDATE/DELETE, and anon
--   -- to carry none of them
-- ============================================================================

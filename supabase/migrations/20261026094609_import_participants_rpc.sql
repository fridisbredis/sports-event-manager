-- ============================================================================
-- Migration 20261026094609: import_participants RPC (N21 / PART-01)
-- ============================================================================
--
-- The write half of the Race Results import. One call per stage, one
-- transaction, three effects: upsert the rows present in the response,
-- withdraw the race_results rows that are absent from it, and un-withdraw
-- any that have come back.
--
-- WHY AN RPC AND NOT A SEQUENCE OF .insert()/.update() CALLS. An import
-- touches many rows and has to do those three things together. Half an
-- import — rows upserted but nobody withdrawn, or withdrawals applied
-- against an upsert that then failed — is exactly the intermediate state
-- docs/patterns/atomic-multi-table-writes.md (REL-01) exists to prevent,
-- and it would be visible to any admin reading the roster. This is the
-- ninth instance of that pattern.
--
-- WHY ONE STAGE PER CALL rather than every stage in one. Each stage is a
-- separate HTTP request to an undocumented third-party API (spike §6). If
-- stage 3 of 6 times out, the first two must stay imported — so the
-- transaction boundary is the stage, and the caller loops, reporting per
-- stage. Making the whole import one transaction would discard good data
-- because of a later network failure.
--
-- WITHDRAWAL, NOT DELETION (the card's question 3). A row struck from the
-- start list is flagged, never removed:
--   - a deletion is unrecoverable if the import ran against the wrong race
--     or against a truncated response, and this API gives no way to tell a
--     short answer from a real one
--   - a struck participant can re-enter, and then withdrawn_at is cleared
--   - it matches how this codebase already handles the same question in
--     remove_official (0025) and the GDPR anonymisation (0029)
-- Peter has not answered question 3; this is the proposal on the card and
-- on docs/plans/n21-participant-admin-plan.md §2, implemented so the
-- import works. If he decides otherwise it is a change to this function
-- body, not to the schema — withdrawn_at stays useful either way.
--
-- MANUAL ROWS ARE NEVER TOUCHED. Every statement here is scoped to
-- source = 'race_results'. A participant an admin typed in by hand is not
-- upserted, not withdrawn, and not revived by any import run. That is the
-- meaning of the card's "Manual entries get a separate ID series", and the
-- participants_external_id_matches_source constraint (migration
-- 20261026084206) is what keeps the two populations from ever overlapping.
--
-- Forward-fix: additive (new function; no existing body is replaced)
--   Rollback: DROP FUNCTION IF EXISTS public.import_participants(uuid, uuid, jsonb);
--             Nothing else referenced it, so there is no prior definition
--             to restore — this is the first version.
--   Data:     no data loss from dropping the function. Rows it has already
--             written stay as they are; the import simply stops being
--             callable. Note the inverse is NOT true — running the
--             function writes participant rows, and an import against the
--             wrong stage is undone by re-importing the right list, not by
--             this rollback.
--   Blast:    nothing before the UI ships. No deployed code calls this.
--             After the UI ships, dropping it makes the import button
--             return a translated failure; the roster itself still reads.
--   Window:   compatible. A new function is additive by construction —
--             currently-deployed code neither calls it nor can be broken
--             by it, and no existing RPC's return shape changes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- import_participants(p_tenant_id, p_stage_id, p_rows)
--
-- SECURITY INVOKER (the default) on purpose: the caller's RLS applies, so
-- the tenant_admin_manage_participants policy is what authorises the write
-- rather than this function trusting its own arguments. The app layer
-- checks the tenant and the tier on top of that (defence in depth, per
-- CLAUDE.md) — but if both app checks were bypassed, RLS still refuses a
-- write to another tenant's rows.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.import_participants(
  p_tenant_id uuid,
  p_stage_id  uuid,
  p_rows      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted  integer := 0;
  v_updated   integer := 0;
  v_withdrawn integer := 0;
  v_revived   integer := 0;
  v_linked    integer := 0;
  v_seen      text[];
BEGIN
  IF p_tenant_id IS NULL OR p_stage_id IS NULL THEN
    RAISE EXCEPTION 'import_participants requires a tenant and a stage'
      USING ERRCODE = 'P0002';
  END IF;

  IF jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'import_participants expects p_rows to be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  -- The stage must belong to the tenant. Without this an admin of tenant A
  -- could link their participants to tenant B's stage: RLS on participants
  -- checks the participant's own tenant_id and would not catch it, because
  -- the row being written is legitimately theirs. Checked against what the
  -- caller can see, so it fails closed under RLS.
  IF NOT EXISTS (
    SELECT 1 FROM public.event_stages s
    WHERE s.id = p_stage_id AND s.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Stage % does not belong to tenant %', p_stage_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  -- The external ids present in this response. Also the "is it absent?"
  -- set for the withdrawal step below.
  SELECT coalesce(array_agg(DISTINCT r->>'external_id'), ARRAY[]::text[])
    INTO v_seen
  FROM jsonb_array_elements(p_rows) AS r
  WHERE nullif(trim(coalesce(r->>'external_id', '')), '') IS NOT NULL;

  -- How many of the people in this response are currently marked as
  -- struck. Counted HERE, before the upsert below clears withdrawn_at —
  -- afterwards the information is gone. This is what lets the result say
  -- "2 came back" instead of silently folding a revival into `updated`,
  -- which would read as an ordinary change to an admin.
  SELECT count(*) INTO v_revived
  FROM public.participants p
  WHERE p.tenant_id = p_tenant_id
    AND p.source = 'race_results'
    AND p.withdrawn_at IS NOT NULL
    AND p.external_id = ANY (v_seen);

  -- --------------------------------------------------------------------
  -- 1. Upsert the rows the response carries.
  --
  --    Conflict target is (tenant_id, external_id) where source =
  --    'race_results' — the partial unique index from migration
  --    20261026084206. Keyed per TENANT, not per stage, because Peter's
  --    answer to question 2 is one participant with several stages: the
  --    same person appearing in two stages' lists must resolve to the
  --    same row.
  --
  --    The UPDATE branch deliberately does NOT touch phone, user_id,
  --    sms_opt_out or privacy_accepted_at. Those are ours, not Race
  --    Results': a re-import must never wipe a phone number someone has
  --    since linked, nor reset an opt-out. The card's "overwrite our data
  --    where Race Results has changed" is about the imported fields.
  -- --------------------------------------------------------------------
  WITH input AS (
    SELECT
      nullif(trim(coalesce(r->>'external_id', '')), '') AS external_id,
      nullif(trim(coalesce(r->>'name',        '')), '') AS name,
      nullif(trim(coalesce(r->>'bib',         '')), '') AS bib,
      nullif(trim(coalesce(r->>'category',    '')), '') AS category,
      nullif(trim(coalesce(r->>'club',        '')), '') AS club,
      nullif(trim(coalesce(r->>'nation',      '')), '') AS nation,
      nullif(trim(coalesce(r->>'gender',      '')), '') AS gender,
      coalesce(r->'extra', '{}'::jsonb)                 AS extra
    FROM jsonb_array_elements(p_rows) AS r
    WHERE nullif(trim(coalesce(r->>'external_id', '')), '') IS NOT NULL
  ),
  upserted AS (
    INSERT INTO public.participants AS p (
      tenant_id, source, external_id,
      name, bib, category, club, nation, gender, extra, withdrawn_at
    )
    SELECT
      p_tenant_id, 'race_results', i.external_id,
      i.name, i.bib, i.category, i.club, i.nation, i.gender, i.extra, NULL
    FROM input i
    ON CONFLICT (tenant_id, external_id) WHERE source = 'race_results'
    DO UPDATE SET
      name     = excluded.name,
      bib      = excluded.bib,
      category = excluded.category,
      club     = excluded.club,
      nation   = excluded.nation,
      gender   = excluded.gender,
      extra    = excluded.extra,
      -- Present in this response, so not struck. Clearing it here is what
      -- revives a participant who re-entered.
      withdrawn_at = NULL
    RETURNING p.id, (xmax = 0) AS was_inserted, p.withdrawn_at
  )
  SELECT
    count(*) FILTER (WHERE was_inserted),
    count(*) FILTER (WHERE NOT was_inserted)
    INTO v_inserted, v_updated
  FROM upserted;

  -- --------------------------------------------------------------------
  -- 2. Link every participant in this response to this stage.
  --
  --    Separate from the upsert because the upsert's RETURNING cannot be
  --    joined back to the input rows reliably when ON CONFLICT fires. The
  --    link is keyed on the participant's external id, which is unique per
  --    tenant among race_results rows.
  --
  --    ON CONFLICT DO NOTHING: re-importing the same stage must not fail
  --    on a link that already exists, and the primary key is exactly the
  --    pair being written.
  -- --------------------------------------------------------------------
  WITH linked AS (
    INSERT INTO public.participant_stages (participant_id, stage_id, tenant_id)
    SELECT p.id, p_stage_id, p_tenant_id
    FROM public.participants p
    WHERE p.tenant_id = p_tenant_id
      AND p.source = 'race_results'
      AND p.external_id = ANY (v_seen)
    ON CONFLICT (participant_id, stage_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_linked FROM linked;

  -- --------------------------------------------------------------------
  -- 3. Withdraw the rows this stage used to carry and no longer does.
  --
  --    Scoped to participants LINKED TO THIS STAGE, so importing stage A
  --    never withdraws someone who only ever ran stage B. A participant
  --    entered in two stages and struck from one keeps their row and
  --    their other link; withdrawn_at is set only when the response for a
  --    stage they are linked to no longer lists them.
  --
  --    Already-withdrawn rows are excluded so a repeated import does not
  --    keep moving the timestamp forward — the date should say when they
  --    were first struck.
  --
  --    A MANUAL ROW IS PROTECTED HERE TWICE OVER, and the second one is
  --    easy to miss. The explicit `source = 'race_results'` is the first.
  --    The second is SQL's three-valued logic: a manual row has
  --    external_id NULL, so `NOT (NULL = ANY (v_seen))` evaluates to NULL
  --    rather than TRUE and the row fails the WHERE regardless. Verified
  --    by mutation — removing either one alone still protects manual
  --    rows; only removing BOTH withdraws them. Neither is therefore
  --    redundant: keep both, because the day someone gives manual rows a
  --    non-NULL external_id, the three-valued safety net disappears
  --    silently and `source` becomes the only thing left.
  -- --------------------------------------------------------------------
  WITH withdrawn AS (
    UPDATE public.participants p
    SET withdrawn_at = now()
    WHERE p.tenant_id = p_tenant_id
      AND p.source = 'race_results'
      AND p.withdrawn_at IS NULL
      AND NOT (p.external_id = ANY (v_seen))
      AND EXISTS (
        SELECT 1 FROM public.participant_stages ps
        WHERE ps.participant_id = p.id AND ps.stage_id = p_stage_id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_withdrawn FROM withdrawn;

  RETURN jsonb_build_object(
    'inserted',  v_inserted,
    'updated',   v_updated,
    'linked',    v_linked,
    'withdrawn', v_withdrawn,
    'revived',   v_revived
  );
END;
$$;

-- The COMMENT is this function's p_rows contract: `supabase gen types`
-- cannot see inside a jsonb parameter, so the generated signature is
-- `Json` and this text is the only contract there is (F-REL-16).
COMMENT ON FUNCTION public.import_participants IS
  'Imports one Race stage''s Race Results participant list for a tenant, in '
  'one transaction (REL-01). N21 / PART-01, migration 20261026094609. '
  'p_rows is a JSON array; per element: '
  'external_id (text, REQUIRED — Race Results'' own ID field, not the bib; '
  'elements without one are skipped silently here because the parser has '
  'already counted and reported them), '
  'name / bib / category / club / nation / gender (text, optional; empty '
  'strings are stored as NULL), '
  'extra (jsonb object, optional, defaults to {} — the Race Results fields '
  'that have no column of their own). '
  'Returns { inserted, updated, linked, withdrawn, revived } as integers, '
  'where `revived` counts people in the response who were marked struck '
  'before this call and are no longer (counted before the upsert clears '
  'the flag, since afterwards the information is gone). '
  'Only rows with source = ''race_results'' are read or written: a manually '
  'added participant is never upserted, withdrawn or revived by an import. '
  'A participant absent from the response but linked to p_stage_id is '
  'withdrawn (withdrawn_at = now()), not deleted — the card''s question 3, '
  'answered per the proposal in docs/plans/n21-participant-admin-plan.md. '
  'Raises P0002 if p_stage_id does not belong to p_tenant_id under caller '
  'RLS (which also catches a stage the caller cannot see), and 22023 if '
  'p_rows is not a JSON array. SECURITY INVOKER: caller RLS governs the '
  'write; the app layer additionally enforces tenant access and the '
  'premium `participants` tier gate.';

-- anon must never reach this (0035 revoked table DML from anon for the same
-- reason). An import is a tenant_admin action behind a server action.
REVOKE ALL ON FUNCTION public.import_participants(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_participants(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_participants(uuid, uuid, jsonb) TO authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with (db push matches on the version prefix and skips a colliding
-- migration SILENTLY — check the catalog, not the push log):
--
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname = 'import_participants';
--   -- expect one row, prosecdef = false (SECURITY INVOKER)
--
--   SELECT has_function_privilege('authenticated',
--     'public.import_participants(uuid,uuid,jsonb)', 'EXECUTE');  -- true
--   SELECT has_function_privilege('anon',
--     'public.import_participants(uuid,uuid,jsonb)', 'EXECUTE');  -- false
-- ============================================================================

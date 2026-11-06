-- ============================================================================
-- Migration 20261106123522: publish_event refuses Standard tenants and
-- archived events (N36)
-- ============================================================================
--
-- N36 gives publish its meaning: publishing opens the PARTICIPANT side of an
-- event (claim list and participant pages). Admin and official screens are
-- open in every state. Publishing is Premium and up (PB5); a Standard tenant
-- must not be able to publish — "UI and server", per the card.
--
-- The server action checks the tier too, but publish_event is a plain
-- SECURITY INVOKER function that any signed-in tenant admin can call straight
-- through PostgREST, past the action. So the function itself refuses.
--
-- Two new refusals, checked under the same FOR UPDATE lock as before:
--
--   1. The event is archived -> P0004 (the archive lock's code; the app
--      already maps it to "this event is archived"). Before this, publishing
--      an archived event set it straight to 'published' — an un-archive that
--      skipped the "comes back as a draft" rule setEventArchived keeps. The
--      UI never offered it; a direct call could.
--
--   2. The tenant's tier does not include publishing -> P0005 (new, custom).
--      The tiers are spelled out here, ('premium', 'professional'), mirroring
--      TIER_FEATURES.publish in src/lib/tiers/features.ts; a unit test in
--      features.test.ts reads this file and fails if the two disagree. An
--      unreadable tenant row or an unknown tier refuses (fails closed, as
--      hasFeature does).
--
-- The already-published no-op is unchanged and is checked BEFORE the tier,
-- so a Standard tenant whose event is stored 'published' (from before a
-- downgrade) gets `false`, not an error. That stored status opens nothing:
-- isParticipantSideOpen (src/lib/events/participant-side.ts) requires the
-- tier as well.
--
-- Everything else is identical to migration 20260908143523: same signature
-- (p_event_id uuid, p_tenant_id uuid), same boolean return (true = this call
-- transitioned draft -> published, false = already published), same P0002
-- and 23514 errors, same row lock pairing with sync_event_stages.
-- CREATE OR REPLACE keeps the existing grants. `SET search_path = public`
-- is added, as on every newer function here.
--
-- Unpublish needs no SQL: it is one guarded UPDATE (status 'published' ->
-- 'draft') from the server action under tenant_admin_manage_events, which
-- can only relax the published => Race stage invariant, never break it.
--
-- Forward-fix: replace
--   Rollback: restore public.publish_event verbatim from migration
--             20260908143523_publish_event_rpc.sql (CREATE OR REPLACE, same
--             signature, so grants survive). App code keeps working against
--             the old body: the action checks the tier itself first.
--   Data:     no data loss. Touches no rows when it runs; the only write the
--             new body makes is the same status = 'published' UPDATE as
--             before, now refused in more cases, never made in more.
--             PROD SNAPSHOT NOT YET TAKEN — Frida: run
--             scripts/ops/snapshot-prod-db.sh 20261106123522 before the prod
--             push and put the filename on this line.
--   Blast:    if the new body is wrong, publishing fails for Premium /
--             Professional admins (they see the generic save error); nothing
--             already published changes. Unpublish is unaffected.
--   Window:   compatible. Old code calls the same signature and reads the
--             same boolean. A Standard tenant on old code now gets P0005,
--             which old code shows as the generic save error — the intended
--             outcome, worded vaguely for one deploy window.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_event(
  p_event_id  uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_event_name    text;
  v_event_status  text;
  v_tier          text;
  v_race_stage_ct integer;
BEGIN
  -- Lock the events row first; sync_event_stages takes the same lock before
  -- it reads events.status, so the two serialize (migration 20260908143523).
  SELECT name, status INTO v_event_name, v_event_status
  FROM events
  WHERE id = p_event_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found for tenant %', p_event_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_event_status = 'archived' THEN
    RAISE EXCEPTION 'Event % is archived; un-archive it before publishing', p_event_id
      USING ERRCODE = 'P0004';
  END IF;

  IF v_event_status = 'published' THEN
    RETURN false; -- already published: no-op
  END IF;

  -- N36 / PB5: Premium and up. Mirrors TIER_FEATURES.publish.
  SELECT tier INTO v_tier FROM tenants WHERE id = p_tenant_id;

  IF v_tier IS NULL OR v_tier NOT IN ('premium', 'professional') THEN
    RAISE EXCEPTION 'Publishing needs the Premium tier or higher.'
      USING ERRCODE = 'P0005';
  END IF;

  IF v_event_name IS NULL OR trim(v_event_name) = '' THEN
    RAISE EXCEPTION 'Event name is required before publishing.'
      USING ERRCODE = '23514';
  END IF;

  -- Counted under the lock taken above (PB8: name + one Race stage).
  SELECT count(*) INTO v_race_stage_ct
  FROM event_stages
  WHERE event_id = p_event_id AND tenant_id = p_tenant_id AND stage_type = 'race';

  IF v_race_stage_ct = 0 THEN
    RAISE EXCEPTION 'Add at least one Race stage before publishing.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE events SET status = 'published'
  WHERE id = p_event_id AND tenant_id = p_tenant_id;

  RETURN true; -- actually transitioned draft -> published this call
END;
$$;

COMMENT ON FUNCTION public.publish_event IS
  'Publishes an event, which opens its participant side (N36). Returns true '
  'if this call transitioned the event from draft to published; false if it '
  'was already published (no-op, no error). Raises P0002 if the events row '
  'is not visible for (p_event_id, p_tenant_id) under caller RLS; P0004 if '
  'the event is archived; P0005 if the tenant''s tier is not premium or '
  'professional (mirrors TIER_FEATURES.publish); 23514 if the name is blank '
  'or there is no stage_type = ''race'' row. Takes SELECT ... FOR UPDATE on '
  'the events row first, serializing against sync_event_stages (migration '
  '20260908143523). Caller must be tenant_admin or system_admin for '
  'p_tenant_id (app layer + RLS). Migration 20261106123522.';

-- ============================================================================
-- Migration 0041: restate the sync_event_stages p_stages contract in its COMMENT
-- ============================================================================
--
-- sync_event_stages has been redefined four times (0005, 0007, 0008, 0039).
-- Its SQL signature — (uuid, uuid, jsonb) — has never changed; what changed
-- each time is the shape of the objects inside p_stages, which Postgres does
-- not declare and `supabase gen types` cannot see (it emits `p_stages: Json`).
--
-- 0007 and 0008 carried the accepted-key list in COMMENT ON FUNCTION, tagged
-- with a version marker ('Stage model v0.7', then 'v0.7 + 0008'). 0039 rewrote
-- the comment to describe its new upsert semantics and dropped both the key
-- list and the marker. This migration restores them alongside 0039's wording,
-- so `\df+ sync_event_stages` on a live database answers "what does this
-- accept?" without reading four migration files in the right order.
--
-- Comment only. The function body is untouched — 0039 remains the authoritative
-- definition.
--
-- Forward-fix: replace
--   Rollback: Restore the COMMENT ON FUNCTION statement from migration
--             0039_fix_sync_event_stages_upsert.sql verbatim.
--   Data:     no data loss — a comment carries no data and no behaviour.
--   Blast:    none. Function behaviour, signature and grants are unchanged;
--             no application code reads pg_description.
--   Window:   compatible. Nothing about the callable interface changes, so
--             the currently deployed image is unaffected in either direction.
-- ============================================================================

COMMENT ON FUNCTION public.sync_event_stages IS
  'Upserts stages for p_event_id: existing stages (matched by id) keep their '
  'row and id so workstations.stage_id / assignments are not cascade-deleted; '
  'stages removed from p_stages are deleted; new stages (no id) are inserted. '
  'Distances are still fully replaced per call. '
  'Caller must be authenticated with tenant_admin or system_admin role (enforced by app layer + RLS). '
  'Stage model v0.7 + 0008 + 0039. p_stages is a JSON array; per element: '
  'id (uuid, optional — upsert key; omit to insert), '
  'name (text, required; elements with a blank name are skipped), '
  'stage_type (''race'' | ''non_race''; defaults to ''race''), '
  'race_type (''distance'' | ''time''; defaults to ''distance''), '
  'start_time / end_time (ISO 8601 timestamptz, or null), '
  'venue (text, optional), '
  'position (integer; defaults to 0), '
  'distances ([{label, position}]; Race stages only). '
  'The legacy event_stages.stage_date column is always written NULL. '
  'This contract is mirrored by StageInput in '
  'src/app/(tenant)/[tenantSlug]/admin/event/actions.ts and is NOT enforced by '
  'the generated types (p_stages is Json) — see F-REL-16.';

-- ============================================================================
-- DONE
-- ============================================================================

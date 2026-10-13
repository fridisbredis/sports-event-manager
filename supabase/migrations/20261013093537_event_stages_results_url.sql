-- ============================================================================
-- Migration 20261013093537: event_stages.results_url (EVT-02 / INFO-01)
-- ============================================================================
--
-- A Race stage gets one optional external link to its results, entered in the
-- EVT-02 stage modal and shown on INFO-01 beneath that stage's card. This is
-- the simple variant of the external-links idea: one column, one field, one
-- link per Race stage — deliberately NOT the typed/multi-link model, which
-- stays a draft. Nothing here forecloses that model later: a future
-- stage_links table can backfill from this column and the column can then be
-- dropped in its own migration.
--
-- Race-only is a UI rule, not a DB constraint. A non_race stage's results_url
-- is written NULL by the RPC (same shape as the existing `distances` rule,
-- which the RPC also drops for non_race rather than rejecting), so a
-- constraint here would add a failure mode without changing any reachable
-- state. Length is capped at 2048 to match the de-facto URL ceiling; scheme
-- is validated in the app layer (http/https only) rather than by a CHECK, so
-- an admin pasting a bad value gets a translated field error instead of a
-- 23514 the form would have to decode.
--
-- Three functions are replaced because all three carry the stage column list:
--   sync_event_stages      — writes it (EVT-02 save path)
--   get_admin_event_cached — reads it back into the modal
--   get_event_info_cached  — reads it for INFO-01
--
-- Forward-fix: additive (column) + replace (three function bodies)
--   Rollback: ALTER TABLE public.event_stages DROP COLUMN results_url;
--             then re-run, verbatim and in this order, the prior bodies:
--               supabase/migrations/20260910115206_sync_event_stages_distinct_sqlstate.sql
--               supabase/migrations/0052_admin_event_cache_rpc.sql
--               supabase/migrations/20260929153848_event_info_cached_add_stage_date.sql
--             (0052 also defines tables/grants — re-run only its
--             get_admin_event_cached function body, not the whole file.)
--   Data:     dropping the column loses whatever links admins have entered;
--             they are not recoverable from any other table. Capture them
--             first with:
--               SELECT id, tenant_id, name, results_url FROM public.event_stages
--               WHERE results_url IS NOT NULL;
--             No other data is touched — the column is added NULL, so no
--             existing row changes.
--   Blast:    if the column is dropped while the new app image is live, the
--             three RPCs still reference it and every EVT-02 save, EVT-02
--             load and INFO-01 render raises 42703 (undefined column) — i.e.
--             drop the column only together with restoring the three bodies,
--             never on its own.
--   Window:   compatible in both directions. The column is nullable with no
--             default, so currently-deployed code that never mentions it
--             keeps inserting and updating rows exactly as before. The two
--             read RPCs only ADD a key to their jsonb payload: old app code
--             ignores the unknown key, and new app code reading an old
--             payload gets `undefined`, which it renders the same as null
--             (no link shown). sync_event_stages reads the key out of
--             p_stages with `s->>'results_url'`, which is SQL NULL when an
--             old client omits it — so an old client's save blanks the
--             column rather than failing. That is the expected expand-phase
--             behaviour here and the reason to deploy the image promptly
--             after this migration, not a correctness hazard: the admin UI
--             is the only writer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The column.
-- ----------------------------------------------------------------------------

ALTER TABLE public.event_stages
  ADD COLUMN IF NOT EXISTS results_url text;

ALTER TABLE public.event_stages
  DROP CONSTRAINT IF EXISTS event_stages_results_url_length_check;

ALTER TABLE public.event_stages
  ADD CONSTRAINT event_stages_results_url_length_check
  CHECK (results_url IS NULL OR length(results_url) <= 2048);

COMMENT ON COLUMN public.event_stages.results_url IS
  'Optional external results link for a Race stage (EVT-02 modal, shown on '
  'INFO-01). Nullable; no scheme constraint at the DB level — the app layer '
  'accepts http/https only. Written NULL for non_race stages by '
  'sync_event_stages. The simple one-link-per-stage variant; a typed '
  'multi-link model remains a draft and would supersede this column.';

-- ----------------------------------------------------------------------------
-- 2. sync_event_stages — write the column.
--
--    Body is verbatim from 20260910115206 (the current definition) except
--    for results_url in the INSERT column list, the SELECT, and the
--    ON CONFLICT UPDATE SET. `create or replace function` replaces the body
--    wholesale, so the whole thing has to be restated; nothing else about
--    the delete/upsert/distances/Race-stage-guard logic changes, and the
--    FOR UPDATE lock pairing with publish_event is preserved.
--
--    Non-race stages are forced to NULL here, matching how this function
--    already drops a non_race element's `distances` rather than rejecting
--    them: Race-only is the UI's rule and the RPC enforces it by coercion.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_event_stages(
  p_event_id  uuid,
  p_tenant_id uuid,
  p_stages    jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_status  text;
  v_race_stage_ct integer;
BEGIN
  -- Delete stages that are no longer present in p_stages (admin removed
  -- them in the form). This is the only intended cascade to workstations.
  DELETE FROM event_stages
  WHERE event_id = p_event_id
    AND tenant_id = p_tenant_id
    AND id <> ALL (
      SELECT (s->>'id')::uuid
      FROM jsonb_array_elements(p_stages) AS s
      WHERE s->>'id' IS NOT NULL
    );

  -- Upsert stages: update existing rows by id (preserves id, so
  -- workstations.stage_id / assignments stay intact), insert new rows
  -- for stages with no id.
  INSERT INTO event_stages (
    id, event_id, tenant_id,
    name, stage_type, race_type,
    start_time, end_time, venue,
    results_url,
    stage_date,   -- kept nullable; new rows always NULL
    position
  )
  SELECT
    coalesce((s->>'id')::uuid, gen_random_uuid()),
    p_event_id,
    p_tenant_id,
    trim(s->>'name'),
    coalesce(nullif(trim(s->>'stage_type'), ''), 'race'),
    coalesce(nullif(trim(s->>'race_type'),  ''), 'distance'),
    nullif(trim(coalesce(s->>'start_time', '')), '')::timestamptz,
    nullif(trim(coalesce(s->>'end_time',   '')), '')::timestamptz,
    nullif(trim(coalesce(s->>'venue',      '')), ''),
    CASE
      WHEN coalesce(nullif(trim(s->>'stage_type'), ''), 'race') = 'race'
        THEN nullif(trim(coalesce(s->>'results_url', '')), '')
      ELSE NULL
    END,
    NULL,
    coalesce((s->>'position')::integer, 0)
  FROM jsonb_array_elements(p_stages) AS s
  WHERE trim(coalesce(s->>'name', '')) <> ''
  ON CONFLICT (id) DO UPDATE SET
    name        = excluded.name,
    stage_type  = excluded.stage_type,
    race_type   = excluded.race_type,
    start_time  = excluded.start_time,
    end_time    = excluded.end_time,
    venue       = excluded.venue,
    results_url = excluded.results_url,
    position    = excluded.position;

  -- Distances: still fully replaced per event (no FK from workstations
  -- to event_distances, so no cascade risk here). Matched by the stage's
  -- id now that ids are stable, instead of by name.
  DELETE FROM event_distances
  WHERE event_id = p_event_id AND tenant_id = p_tenant_id;

  INSERT INTO event_distances (event_id, tenant_id, stage_id, label, position)
  SELECT
    p_event_id,
    p_tenant_id,
    es.id,
    trim(d->>'label'),
    coalesce((d->>'position')::integer, 0)
  FROM jsonb_array_elements(p_stages) AS s
  JOIN event_stages es
    ON  es.event_id  = p_event_id
    AND es.tenant_id = p_tenant_id
    AND es.id        = coalesce((s->>'id')::uuid, es.id)
    AND es.name       = trim(s->>'name')
  CROSS JOIN LATERAL jsonb_array_elements(
    coalesce(s->'distances', '[]'::jsonb)
  ) AS d
  WHERE
    coalesce(nullif(trim(s->>'stage_type'), ''), 'race') = 'race'
    AND trim(coalesce(d->>'label', '')) <> '';

  -- Stage model v0.7 invariant, enforced here as the RPC-level backstop: a
  -- published event must keep at least one Race stage. Checked last,
  -- against the table state this same transaction just wrote, so it sees
  -- the final row set regardless of which branch above ran. Fails closed:
  -- if the events row isn't visible under caller RLS, that's treated as
  -- "can't confirm this is safe" rather than silently skipping the check
  -- (mirrors the fail-closed posture of the app-level check in saveEvent).
  --
  -- FOR UPDATE (EVT-02, migration 20260908143523): locks the events row
  -- before reading status, so a concurrent publish_event call on the same
  -- event blocks here until publish_event's transaction commits (or vice
  -- versa) instead of both reading a stale status and committing an
  -- invariant violation. This is the other half of the lock pairing
  -- described in publish_event's own comment.
  SELECT status INTO v_event_status
  FROM events
  WHERE id = p_event_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found for tenant %', p_event_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_event_status = 'published' THEN
    SELECT count(*) INTO v_race_stage_ct
    FROM event_stages
    WHERE event_id = p_event_id
      AND tenant_id = p_tenant_id
      AND stage_type = 'race';

    IF v_race_stage_ct = 0 THEN
      -- F-REL-22: custom SQLSTATE (not 23514) so the app can tell this
      -- apart from event_stages_times_order_check, which also raises
      -- 23514 from the INSERT above in the same function call.
      RAISE EXCEPTION 'Cannot remove the last Race stage from a published event.'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;
END;
$$;

-- The COMMENT is this function's p_stages contract (F-REL-16: the generated
-- types can't see inside a jsonb parameter, so this text is the contract).
-- Restated in full with the results_url element documented.
COMMENT ON FUNCTION public.sync_event_stages IS
  'Upserts stages for p_event_id: existing stages (matched by id) keep their '
  'row and id so workstations.stage_id / assignments are not cascade-deleted; '
  'stages removed from p_stages are deleted; new stages (no id) are inserted. '
  'Distances are still fully replaced per call. '
  'Caller must be authenticated with tenant_admin or system_admin role (enforced by app layer + RLS). '
  'Stage model v0.7 + 0008 + 0039. p_stages is a JSON array; per element: '
  'id (uuid, optional — upsert key; omit to insert), '
  'name (text, required; elements with a blank name are skipped — one that '
  'also carries an id is neither updated nor deleted, so its existing row '
  'survives unchanged), '
  'stage_type (''race'' | ''non_race''; defaults to ''race''), '
  'race_type (''distance'' | ''time''; defaults to ''distance''), '
  'start_time / end_time (timestamptz; absent or empty becomes null, but a '
  'non-empty value is cast, not coerced — unparseable raises 22007 and '
  'date-shaped-but-invalid (2026-02-30, month 13, hour 25) raises 22008), '
  'venue (text, optional), '
  'results_url (text, optional — external results link, Race stages only; '
  'absent or empty becomes null, and a non_race element''s value is dropped '
  'to null the same way its distances are. Max 2048 chars or the element '
  'trips event_stages_results_url_length_check (23514); scheme is not '
  'checked here — the app layer accepts http/https only. Migration '
  '20261013093537), '
  'position (integer; defaults to 0), '
  'distances ([{label, position}]; Race stages only — a non_race element''s '
  'distances are silently dropped). '
  'end_time must be >= start_time or the element trips '
  'event_stages_times_order_check (23514). An error raised by any one element '
  'aborts the whole call — the write is all-or-nothing. '
  'The legacy event_stages.stage_date column is written NULL on insert; the '
  'upsert''s UPDATE branch does not set it, so any pre-existing non-null value '
  'survives a resave. '
  'If the parent event''s status is ''published'', the call also aborts '
  '(P0003, "Cannot remove the last Race stage from a published event.") when '
  'the resulting stage set has zero stage_type = ''race'' rows (migration 0058, '
  'SQLSTATE changed to P0003 by migration 20260910115206 — F-REL-22 — so it '
  'is distinguishable from event_stages_times_order_check''s plain 23514) — '
  'this is the same invariant publishEvent enforces before allowing publish, '
  'held afterwards too as an RPC-level backstop. Serializable against a '
  'concurrent publish_event call as of migration 20260908143523 (both take '
  'SELECT ... FOR UPDATE on the events row before reading status). A direct '
  'DELETE on event_stages bypassing this RPC is caught by the deferred '
  'constraint trigger enforce_published_event_has_race_stage (migration '
  '20260909133414), which raises the same P0003 as of this migration. '
  'Raises P0002 if the events row itself isn''t visible for (p_event_id, '
  'p_tenant_id) under caller RLS, rather than silently skipping the check. '
  'This contract is mirrored by StageInput in '
  'src/app/(tenant)/[tenantSlug]/admin/event/actions.ts and is NOT enforced by '
  'the generated types (p_stages is Json) — see F-REL-16.';

-- ----------------------------------------------------------------------------
-- 3. get_admin_event_cached — read it back into the EVT-02 modal.
--
--    Body verbatim from 0052 except for 'results_url' in the stages
--    jsonb_build_object and the matching line in the shape contract. 0052's
--    header carries the rationale for the SECURITY DEFINER /
--    cache_rpc_reader construction, the transaction-local GUC and the grant
--    pair; none of that changes here, and `create or replace function`
--    preserves the existing owner and ACL. No new table is read — the new
--    column sits on public.event_stages, already covered by 0052's grant
--    and policy.
-- ----------------------------------------------------------------------------

create or replace function public.get_admin_event_cached(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id   uuid;
  v_event      jsonb;
  v_stages     jsonb;
  v_distances  jsonb;
  v_facilities jsonb;
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);

  -- Column list matches the `events` select in admin/event/page.tsx
  -- exactly, including
  -- `id` — the page passes it to the child queries and to the editor form.
  select e.id,
         jsonb_build_object(
           'id', e.id,
           'name', e.name,
           'event_type', e.event_type,
           'description', e.description,
           'location', e.location,
           'logo_url', e.logo_url,
           'status', e.status,
           'scheduling_granularity_min', e.scheduling_granularity_min
         )
    into v_event_id, v_event
  from public.events e
  where e.tenant_id = p_tenant_id
  order by e.created_at asc
  limit 1;

  -- Column list matches that page's `event_stages` select. Note
  -- `race_type`, which
  -- get_event_info_cached does not read, and `results_url`, which it does
  -- (migration 20261013093537).
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'stage_type', s.stage_type,
               'race_type', s.race_type,
               'start_time', s.start_time,
               'end_time', s.end_time,
               'venue', s.venue,
               'results_url', s.results_url,
               'position', s.position
             )
             order by s.position asc
           ),
           '[]'::jsonb
         )
    into v_stages
  from public.event_stages s
  where s.event_id = v_event_id
    and s.tenant_id = p_tenant_id;

  -- Column list matches that page's `event_distances` select — no `id`,
  -- as there.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'label', d.label,
               'position', d.position,
               'stage_id', d.stage_id
             )
             order by d.position asc
           ),
           '[]'::jsonb
         )
    into v_distances
  from public.event_distances d
  where d.event_id = v_event_id
    and d.tenant_id = p_tenant_id;

  -- Column list matches that page's `event_facilities` select — `label`
  -- and `position` only,
  -- narrower than get_event_info_cached's, which also returns `id`.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'label', f.label,
               'position', f.position
             )
             order by f.position asc
           ),
           '[]'::jsonb
         )
    into v_facilities
  from public.event_facilities f
  where f.event_id = v_event_id
    and f.tenant_id = p_tenant_id;

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { id, name, event_type, description, location, logo_url,
  --              status, scheduling_granularity_min } | null,
  --     stages:     [ { id, name, stage_type, race_type, start_time,
  --                     end_time, venue, results_url, position } ],
  --     distances:  [ { label, position, stage_id } ],
  --     facilities: [ { label, position } ] }
  -- `event` is JSON null when the tenant has no event row — the page's
  -- notFound() signal. The three arrays are always arrays, never null; when
  -- `event` is null they are empty, since v_event_id is then NULL and every
  -- child predicate fails.
  return jsonb_build_object(
    'event', v_event,
    'stages', v_stages,
    'distances', v_distances,
    'facilities', v_facilities
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. get_event_info_cached — read it for INFO-01.
--
--    Body verbatim from 20260929153848 except for 'results_url' in the
--    stages jsonb_build_object and the matching line in the shape contract.
--    See 0051 for the construction rationale; ownership, grants and the
--    three cache_rpc_reader policies are untouched.
-- ----------------------------------------------------------------------------

create or replace function public.get_event_info_cached(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event      jsonb;
  v_stages     jsonb;
  v_facilities jsonb;
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);

  select jsonb_build_object(
           'name', e.name,
           'event_type', e.event_type,
           'description', e.description,
           'logo_url', e.logo_url,
           'status', e.status
         )
    into v_event
  from public.events e
  where e.tenant_id = p_tenant_id
  order by e.created_at asc
  limit 1;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'stage_type', s.stage_type,
               'stage_date', s.stage_date,
               'start_time', s.start_time,
               'end_time', s.end_time,
               'venue', s.venue,
               'results_url', s.results_url,
               'position', s.position
             )
             order by s.position asc
           ),
           '[]'::jsonb
         )
    into v_stages
  from public.event_stages s
  where s.tenant_id = p_tenant_id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', f.id,
               'label', f.label,
               'position', f.position
             )
             order by f.position asc
           ),
           '[]'::jsonb
         )
    into v_facilities
  from public.event_facilities f
  where f.tenant_id = p_tenant_id;

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { name, event_type, description, logo_url, status } | null,
  --     stages:     [ { id, name, stage_type, stage_date, start_time,
  --                     end_time, venue, results_url, position } ],
  --     facilities: [ { id, label, position } ] }
  -- `event` is JSON null when the tenant has no event row; the two arrays
  -- are always arrays, never null.
  return jsonb_build_object(
    'event', v_event,
    'stages', v_stages,
    'facilities', v_facilities
  );
end;
$$;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'event_stages' AND column_name = 'results_url';
--
--   -- All three functions carry the new key:
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('sync_event_stages', 'get_admin_event_cached',
--                     'get_event_info_cached')
--     AND prosrc LIKE '%results_url%';
--   -- expect 3 rows
--
--   -- Round-trip: save a Race stage with a link via EVT-02, then confirm
--   -- both read RPCs return it, and that setting the same stage to
--   -- non_race clears it.
-- ============================================================================

-- ============================================================================
-- Migration: get_event_info_cached returns stage_date (INFO-01)
-- ============================================================================
--
-- INFO-01 gains a "Dates by stage" section. A stage's day comes from
-- start_time when the admin has set the hour, but EVT-02 lets a stage carry
-- only stage_date (the day pinned, the hour not yet). Without stage_date in
-- this payload, those stages render with a blank date and drop out of the
-- new section entirely, which looks like missing data rather than a stage
-- whose start time is simply not set.
--
-- REPLACE, not additive: this is `create or replace` over the function
-- 0051 created, so the two must be read together — 0051's header carries the
-- full rationale for the SECURITY DEFINER / cache_rpc_reader construction,
-- the transaction-local GUC, the grant pair and the deterministic
-- `order by created_at asc limit 1` on `events`. None of that changes here.
-- The whole body is restated because `create or replace function` replaces
-- it wholesale; only the `stages` jsonb_build_object gains a key.
--
-- ADDITIVE TO THE RETURN SHAPE, so the deploy window is safe in both
-- directions: old app code reading this payload ignores the new key, and new
-- app code reading the old payload gets `undefined` for stage_date, which the
-- page already treats the same as null (it falls back to start_time, then to
-- an empty string that filters the row out). No ordering constraint between
-- the migration and the app deploy.
--
-- Ownership, grants and the three cache_rpc_reader policies from 0051 are
-- untouched: `create or replace` preserves the existing owner and ACL, and
-- no new table or column is read (stage_date already sits on
-- public.event_stages, covered by 0051's grant and policy).
--
-- Forward-fix: replace
--   Rollback: re-run 0051_event_info_cache_rpc.sql, which restores the
--             previous body verbatim. Nothing else to undo — no table,
--             policy, grant or ownership change is made here.
--   Data:     No data loss — read-only function, no table contents change.
--   Blast:    None. Adds one key to a jsonb payload; every existing key keeps
--             its name, type and meaning.
--   Window:   Compatible in both directions (see above).
-- ============================================================================

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
  --                     end_time, venue, position } ],
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

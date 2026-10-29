-- ============================================================================
-- Migration 20261029094424: INFO-01 shows the stages and facilities of the
-- event it is opened for, not of every event in the tenant (N23)
-- ============================================================================
--
-- 20261028142912 taught get_event_info_cached which event to read, but only
-- the event row: the stages and facilities were still selected by tenant
-- alone ("where s.tenant_id = p_tenant_id"). With one event per tenant that
-- was the same thing. With several, INFO-01 for Viadal 2026 listed the
-- programme of every edition — and, since the RPC runs server-side, of
-- events the official is not a member of, past the isolation 20261029090324
-- puts on direct reads. Found by the official-screens e2e suite with three
-- local editions of the seed race.
--
-- The body is 20261028142912's with the event resolved once (v_event_id) and
-- the two child reads filtered on it; lines marked N23. Signature, return
-- shape, owner and grants are unchanged (CREATE OR REPLACE keeps them).
-- When the event is not found, both arrays are empty, as for a tenant
-- without events.
--
-- Forward-fix: replace (get_event_info_cached body replaced)
--   Rollback: restore the body from migration
--             20261028142912_official_event_info_and_seen.sql.
--   Data:     prod snapshot 20261028095200_pre-migration_2026-10-29T12-48-16Z.tar.gz (N23 release).
--             no data loss. Reads only.
--   Blast:    if the filter were wrong, INFO-01 would show no programme or
--             facilities.
--   Window:   compatible. Same arguments and the same keys.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_event_info_cached(p_tenant_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event_id   uuid; -- N23
  v_event      jsonb;
  v_stages     jsonb;
  v_facilities jsonb;
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);

  select e.id, -- N23
         jsonb_build_object(
           'name', e.name,
           'event_type', e.event_type,
           'description', e.description,
           'logo_url', e.logo_url,
           'status', e.status
         )
    into v_event_id, v_event
  from public.events e
  where e.tenant_id = p_tenant_id
    and (p_event_id is null or e.id = p_event_id)
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
  where s.tenant_id = p_tenant_id
    and s.event_id = v_event_id; -- N23

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
  where f.tenant_id = p_tenant_id
    and f.event_id = v_event_id; -- N23

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
$function$;

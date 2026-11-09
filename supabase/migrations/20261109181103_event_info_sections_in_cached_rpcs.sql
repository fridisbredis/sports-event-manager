-- ============================================================================
-- Migration 20261109181103: the cached EVT-02 and INFO-01 RPCs return the
-- event's info sections (N38)
-- ============================================================================
--
-- get_admin_event_cached (EVT-02) and get_event_info_cached (INFO-01) gain
-- one key, `info_sections`, read from event_info_sections (migration
-- 20261109180943) for the resolved event and ordered by position — the
-- admin's order, which INFO-01 shows unchanged (L17).
--
-- `facilities` STAYS in both responses. The image deployed while this
-- schema goes live still destructures it, and the code that stops reading
-- it ships in the same release; the contract migration that drops
-- event_facilities removes the key too. Everything else in both bodies is
-- byte-for-byte the previous one (20261028140031 for the admin RPC,
-- 20261029094424 for the info RPC); new lines are marked N38.
--
-- image_path is returned as stored; the page turns it into a public URL with
-- getPublicUrl (no request — it only builds the string).
--
-- Forward-fix: replace (get_admin_event_cached and get_event_info_cached bodies)
--   Rollback: restore get_admin_event_cached from migration
--             20261028140031_admin_cached_rpcs_take_event.sql and
--             get_event_info_cached from migration
--             20261029094424_event_info_cached_scope_children_to_event.sql.
--   Data:     prod snapshot 20261109181103_pre-migration_2026-11-09T22-01-27Z.tar.gz (N38 release,
--             taken 2026-11-09 right before the prod push).
--             no data loss. Reads only.
--   Blast:    if the new select failed, EVT-02 and INFO-01 would throw for
--             every event (the page rethrows RPC errors) until rolled back.
--   Window:   compatible. Same signatures, every existing key unchanged; the
--             deployed code ignores the extra key.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_event_cached(p_tenant_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event_id      uuid;
  v_event         jsonb;
  v_stages        jsonb;
  v_distances     jsonb;
  v_facilities    jsonb;
  v_info_sections jsonb; -- N38
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
    and (p_event_id is null or e.id = p_event_id) -- N23
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

  -- N38: the event's info sections, in the admin's order.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', i.id,
               'title', i.title,
               'body', i.body,
               'image_path', i.image_path,
               'link_url', i.link_url,
               'link_label', i.link_label,
               'position', i.position
             )
             order by i.position asc, i.created_at asc
           ),
           '[]'::jsonb
         )
    into v_info_sections
  from public.event_info_sections i
  where i.event_id = v_event_id
    and i.tenant_id = p_tenant_id;

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { id, name, event_type, description, location, logo_url,
  --              status, scheduling_granularity_min } | null,
  --     stages:        [ { id, name, stage_type, race_type, start_time,
  --                        end_time, venue, results_url, position } ],
  --     distances:     [ { label, position, stage_id } ],
  --     facilities:    [ { label, position } ],
  --     info_sections: [ { id, title, body, image_path, link_url,
  --                        link_label, position } ] }
  -- `event` is JSON null when the tenant has no event row — the page's
  -- notFound() signal. The arrays are always arrays, never null; when
  -- `event` is null they are empty, since v_event_id is then NULL and every
  -- child predicate fails.
  return jsonb_build_object(
    'event', v_event,
    'stages', v_stages,
    'distances', v_distances,
    'facilities', v_facilities,
    'info_sections', v_info_sections -- N38
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_info_cached(p_tenant_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event_id      uuid; -- N23
  v_event         jsonb;
  v_stages        jsonb;
  v_facilities    jsonb;
  v_info_sections jsonb; -- N38
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

  -- N38: the event's info sections, in the admin's order (L17).
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', i.id,
               'title', i.title,
               'body', i.body,
               'image_path', i.image_path,
               'link_url', i.link_url,
               'link_label', i.link_label,
               'position', i.position
             )
             order by i.position asc, i.created_at asc
           ),
           '[]'::jsonb
         )
    into v_info_sections
  from public.event_info_sections i
  where i.tenant_id = p_tenant_id
    and i.event_id = v_event_id;

  perform pg_catalog.set_config('app.tenant_id', '', true);

  -- Shape contract (asserted key-by-key in the integration test, since
  -- `supabase gen types` cannot see inside a jsonb return — F-REL-16):
  --   { event: { name, event_type, description, logo_url, status } | null,
  --     stages:        [ { id, name, stage_type, stage_date, start_time,
  --                        end_time, venue, results_url, position } ],
  --     facilities:    [ { id, label, position } ],
  --     info_sections: [ { id, title, body, image_path, link_url,
  --                        link_label, position } ] }
  -- `event` is JSON null when the tenant has no event row; the arrays are
  -- always arrays, never null.
  return jsonb_build_object(
    'event', v_event,
    'stages', v_stages,
    'facilities', v_facilities,
    'info_sections', v_info_sections -- N38
  );
end;
$function$;

-- CREATE OR REPLACE keeps owner (cache_rpc_reader) and grants; restated so a
-- reader of this file alone sees the security model.
revoke all on function public.get_admin_event_cached(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_admin_event_cached(uuid, uuid) to service_role;
alter function public.get_admin_event_cached(uuid, uuid) owner to cache_rpc_reader;

revoke all on function public.get_event_info_cached(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_event_info_cached(uuid, uuid) to service_role;
alter function public.get_event_info_cached(uuid, uuid) owner to cache_rpc_reader;
